/** Explicit local QA runner. Running this file requests live, metered repair calls; it never selects a fallback. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  BootstrapData,
  RepairRun,
  ProviderUsageData,
} from "../shared/types.js";
import { FIREWORKS_ULTRA_MODEL } from "./provider-routes.js";

const origin = "http://127.0.0.1:4102";
const retryMode = process.argv.includes("--retry-v5");
const fireworksFour = process.argv.includes("--fireworks-four");
const fireworksOtherThree = process.argv.includes("--fireworks-other-three");
const fireworksRetryV6 = process.argv.includes("--fireworks-retry-failed");
const fireworksRetryV7 = process.argv.includes("--fireworks-v7-retry");
const fireworksRetryV8 = process.argv.includes("--fireworks-v8-combo");
const fireworksRetry = fireworksRetryV6 || fireworksRetryV7 || fireworksRetryV8;
const fireworksMode = fireworksFour || fireworksOtherThree || fireworksRetry;
if (
  [
    retryMode,
    fireworksFour,
    fireworksOtherThree,
    fireworksRetryV6,
    fireworksRetryV7,
    fireworksRetryV8,
  ].filter(Boolean).length > 1
)
  throw new Error("Select one explicit QA mode at a time.");
const fixtures = fireworksRetryV8
  ? ["riverside-support"]
  : fireworksRetry
    ? ["northstar-appointments", "riverside-support"]
    : fireworksMode
      ? [
          "northstar-appointments",
          "riverside-support",
          ...(fireworksFour ? ["atlas-onboarding"] : []),
          "civic-assistance",
        ]
      : retryMode
        ? ["atlas-onboarding", "civic-assistance"]
        : ["riverside-support", "atlas-onboarding", "civic-assistance"];
const tag = fireworksRetryV8
  ? "passage-fireworks-ultra-v8-combo-20261028"
  : fireworksRetryV7
    ? "passage-fireworks-ultra-v7-retry-20261028"
    : fireworksRetry
      ? "passage-fireworks-ultra-v6-retry-20261028"
      : fireworksMode
        ? "passage-fireworks-ultra-v1-20261028"
        : retryMode
          ? "passage-family-live-v5-retry-20261028"
          : "passage-family-live-v1-20261028";
const retryParents = new Map<string, string>();
if (retryMode || fireworksRetry) {
  const previous = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(
          fireworksRetryV8
            ? "../.passage/fireworks-v7-retry-qa.json"
            : fireworksRetryV7
              ? "../.passage/fireworks-retry-qa.json"
              : fireworksRetry
                ? "../.passage/fireworks-other-three-qa.json"
                : "../.passage/live-family-qa.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ) as { reports: { fixtureId: string; runId?: string; pass: boolean }[] };
  for (const fixtureId of fixtures) {
    const record = previous.reports.find(
      (value) => value.fixtureId === fixtureId && !value.pass && value.runId,
    );
    if (!record?.runId)
      throw new Error(`No rejected initial run recorded for ${fixtureId}.`);
    retryParents.set(fixtureId, record.runId);
  }
}
const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
async function request<T>(
  path: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}
async function waitForRun(runId: string): Promise<RepairRun> {
  const deadline = Date.now() + (fireworksMode ? 2100000 : 600000);
  let lastStage = "";
  while (Date.now() < deadline) {
    const run = await request<RepairRun>(`/v1/repairs/${runId}`);
    if (run.status !== lastStage) {
      console.log(`${run.fixtureId} ${run.id} ${run.status}`);
      lastStage = run.status;
    }
    if (
      ![
        "queued",
        "preparing",
        "reproducing",
        "generating",
        "verifying",
      ].includes(run.status)
    )
      return run;
    await pause(750);
  }
  throw new Error(
    `Run ${runId} exceeded the QA wait allowance. It remains available in the API; no duplicate repair was submitted.`,
  );
}
const bootstrap = await request<BootstrapData>("/v1/bootstrap");
if (
  !bootstrap.provider.enabled ||
  bootstrap.provider.provider !== (fireworksMode ? "fireworks" : "nebius") ||
  bootstrap.provider.model !==
    (fireworksMode
      ? FIREWORKS_ULTRA_MODEL
      : "nvidia/nemotron-3-super-120b-a12b")
)
  throw new Error(
    "Start the API with this QA mode's explicitly authorized provider/model before running metered QA. No fallback was selected.",
  );
const reports: unknown[] = [];
let failed = false;
for (const fixtureId of fixtures) {
  try {
    const queued =
      retryMode || fireworksRetry
        ? await request<RepairRun>(
            `/v1/repairs/${retryParents.get(fixtureId)}/retry`,
            { mode: "live" },
            `${tag}-${fixtureId}-retry`,
          )
        : (
            await request<{ run: RepairRun }>(
              "/v1/journeys",
              {
                fixtureId,
                inputMode: "keyboard",
                locale: "en",
                captureConsent: true,
              },
              `${tag}-${fixtureId}-journey`,
            )
          ).run;
    let run = await waitForRun(queued.id);
    if (run.status === "contract_review") {
      await request(
        `/v1/repairs/${run.id}/generate`,
        { mode: "live" },
        `${tag}-${fixtureId}-generate`,
      );
      run = await waitForRun(run.id);
    }
    if (run.status === "ready") {
      const candidate = run.candidates.find(
        (value) =>
          value.id === run.activeCandidateId && value.status === "accepted",
      );
      if (!candidate)
        throw new Error("The ready run has no accepted active candidate.");
      await request(
        `/v1/repairs/${run.id}/challenges`,
        { scenarioId: "combined", candidateDigest: candidate.digest },
        `${tag}-${fixtureId}-combined`,
      );
      run = await waitForRun(run.id);
    }
    const candidate = run.candidates.find(
      (value) => value.id === run.activeCandidateId,
    );
    const combined = run.challenges.find(
      (value) => value.scenario.id === "combined",
    );
    const pass =
      run.status === "ready" &&
      candidate?.verification?.passed === true &&
      combined?.passed === true;
    if (!pass) failed = true;
    reports.push({
      fixtureId,
      runId: run.id,
      pass,
      status: run.status,
      generationFailures: run.generationFailures ?? [],
      sourceDigest: run.baseline?.sourceDigest,
      contractDigest: run.contract.digest,
      baseline: {
        verifierVersion: run.baseline?.verifierVersion,
        passed: run.baseline?.passed,
        checks: run.baseline?.checks.length,
      },
      candidates: run.candidates.map((value) => ({
        revision: value.revision,
        digest: value.digest,
        status: value.status,
        rejectionReason: value.rejectionReason ?? null,
        receipt: value.receipt,
        verification: value.verification
          ? {
              id: value.verification.id,
              verifierVersion: value.verification.verifierVersion,
              passed: value.verification.passed,
              checks: value.verification.checks,
              outcome: value.verification.outcome,
            }
          : null,
      })),
      combined: combined
        ? {
            id: combined.id,
            verifierVersion: combined.verifierVersion,
            passed: combined.passed,
            scenario: combined.scenario,
            checks: combined.checks,
            outcome: combined.outcome,
          }
        : null,
      error: run.error,
    });
    console.log(`${fixtureId}: ${pass ? "PASS" : "FAILED"} (${run.id})`);
  } catch (error) {
    failed = true;
    reports.push({
      fixtureId,
      pass: false,
      error: error instanceof Error ? error.message : String(error),
    });
    console.log(
      `${fixtureId}: QA request failed; remaining families will still be checked.`,
    );
  }
}
const usage = await request<ProviderUsageData>("/v1/provider/usage");
const report = {
  at: new Date().toISOString(),
  scope:
    "Authored synthetic fixtures; live model generation, Chromium keyboard and backend checks; no human study.",
  provider: bootstrap.provider,
  previousReport: fireworksRetryV8
    ? "fireworks-v7-retry-qa.json"
    : fireworksRetryV7
      ? "fireworks-retry-qa.json"
      : fireworksRetry
        ? "fireworks-other-three-qa.json"
        : retryMode
          ? "live-family-qa.json"
          : null,
  reports,
  usage,
};
const dataDir = fileURLToPath(new URL("../.passage/", import.meta.url));
await mkdir(dataDir, { recursive: true });
await writeFile(
  fileURLToPath(
    new URL(
      fireworksRetryV8
        ? "../.passage/fireworks-v8-combo-qa.json"
        : fireworksRetryV7
          ? "../.passage/fireworks-v7-retry-qa.json"
          : fireworksRetry
            ? "../.passage/fireworks-retry-qa.json"
            : fireworksMode
              ? fireworksOtherThree
                ? "../.passage/fireworks-other-three-qa.json"
                : "../.passage/fireworks-family-qa.json"
              : retryMode
                ? "../.passage/live-family-qa-v5.json"
                : "../.passage/live-family-qa.json",
      import.meta.url,
    ),
  ),
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    reports: reports.map((value) => {
      const item = value as {
        fixtureId: string;
        runId?: string;
        pass: boolean;
      };
      return { fixtureId: item.fixtureId, runId: item.runId, pass: item.pass };
    }),
    committedUsd: usage.committedUsd,
  }),
);
if (failed) process.exitCode = 1;
