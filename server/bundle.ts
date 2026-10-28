import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import type { VerificationResult } from "../shared/types.js";
import { Captures } from "./captures.js";
import { Orchestrator } from "./orchestrator.js";
import { AppError, Store, sha256 } from "./store.js";

/** A static review archive. It contains exact evidence bytes, never private assistive capture content. */
export async function buildEvidenceBundle(
  store: Store,
  orchestrator: Orchestrator,
  captures: Captures,
  runId: string,
) {
  const base = await orchestrator.export(runId);
  const run = base.run;
  const files: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  const assets = new Map<string, string>();
  const add = (path: string, content: string | Buffer) => {
    if (files[path]) return;
    const bytes =
      typeof content === "string" ? strToU8(content) : new Uint8Array(content);
    totalBytes += bytes.byteLength;
    if (Object.keys(files).length >= 256 || totalBytes > 30 * 1024 * 1024)
      throw new AppError(
        "BUNDLE_TOO_LARGE",
        "This evidence archive exceeds the local 30 MB or 256-file limit.",
        413,
      );
    files[path] = bytes;
  };
  const json = (path: string, value: unknown) =>
    add(path, JSON.stringify(value, null, 2));
  const results = [
    run.baseline,
    ...run.candidates.map((value) => value.verification),
    ...run.challenges,
  ].filter((value): value is VerificationResult => value !== null);
  for (const result of results)
    for (const artifact of result.artifacts) {
      const filename = /^\/artifacts\/([a-f0-9]{64})\.(png|json|txt)$/.exec(
        new URL(artifact.url, "http://127.0.0.1").pathname,
      );
      if (
        !filename ||
        filename[1] !== artifact.digest ||
        !orchestrator.engine.root
      )
        throw new AppError(
          "BUNDLE_ARTIFACT_UNAVAILABLE",
          "An evidence artifact cannot be resolved to its protected local content-addressed store.",
          503,
        );
      const path = `artifacts/${filename[1]}.${filename[2]}`;
      let content: Buffer;
      try {
        content = await readFile(
          join(
            orchestrator.engine.root,
            "artifacts",
            `${filename[1]}.${filename[2]}`,
          ),
        );
      } catch {
        throw new AppError(
          "BUNDLE_ARTIFACT_UNAVAILABLE",
          "A required screenshot, trace or accessibility artifact is missing from the local evidence store.",
          503,
        );
      }
      if (sha256(content) !== artifact.digest)
        throw new AppError(
          "BUNDLE_ARTIFACT_CORRUPTED",
          "A required evidence artifact failed SHA-256 verification. The archive was not produced.",
          500,
        );
      add(path, content);
      assets.set(artifact.url, path);
    }
  const portable = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (assets.has(value)) return assets.get(value);
      if (
        /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/.test(value) ||
        value.startsWith("/v1/assistive-sessions/")
      )
        return null;
      return value;
    }
    if (Array.isArray(value)) return value.map(portable);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          key === "humanObservations" ? [] : portable(item),
        ]),
      );
    return value;
  };
  const original = base.integrity.artifacts.find(
    (value) => value.name === "original-source",
  );
  if (!original)
    throw new AppError(
      "BUNDLE_SOURCE_UNAVAILABLE",
      "The immutable original source is missing from the evidence manifest.",
      503,
    );
  add("source/original.jsx", store.readArtifact(original.digest));
  json("contract.json", run.contract);
  for (const [index, failure] of (run.generationFailures ?? []).entries()) {
    const folder = `generation-failures/${String(index + 1).padStart(3, "0")}`;
    if (failure.outputArtifact) {
      const path = `${folder}/final-message-content.txt`;
      add(path, store.readArtifact(failure.outputArtifact.digest));
      assets.set(failure.outputArtifact.url, path);
    }
    json(`${folder}/failure.json`, portable(failure));
    json(`${folder}/model-receipt.json`, failure.receipt);
  }
  for (const candidate of run.candidates) {
    const folder = `candidates/${String(candidate.revision).padStart(3, "0")}`;
    const filename = basename(candidate.sourceFile).replace(
      /[^a-zA-Z0-9_.-]/g,
      "_",
    );
    add(`${folder}/${filename}`, candidate.source);
    add(`${folder}/repair.patch`, candidate.patch);
    json(`${folder}/model-receipt.json`, candidate.receipt);
    if (candidate.receipt.finalOutputDigest)
      add(
        `${folder}/final-message-content.txt`,
        store.readArtifact(candidate.receipt.finalOutputDigest),
      );
    json(
      `${folder}/candidate.json`,
      portable({ ...candidate, source: undefined, patch: undefined }),
    );
  }
  for (const result of results)
    json(
      `verification/${result.kind}-${result.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`,
      portable(result),
    );
  json("run.json", portable(run));
  add(
    "README.md",
    `# Passage evidence bundle\n\nRun: ${run.id}\nMode: ${run.mode}\nStatus: ${run.status}${run.isStale ? " (stale contract)" : ""}\n\nThis is a static, portable review archive. Paths in JSON are relative to the archive root. Open screenshots in artifacts/, read verification JSON and compare source/original.jsx with each candidate patch. Model receipts identify the actual provider and NVIDIA model: Nebius submission, charged Fireworks/Together development, or handcrafted offline reference patches. Development-provider results are not Nebius submission receipts. Failed candidates are retained.\n\nThe archive includes no private assistive-session transcript, participant/operator metadata, or legacy human notes. Safe session references do not establish human outcomes. Interactive previews and browser runtime are not included. No screen-reader experience, human study or universal accessibility certification is claimed. Downloaded copies cannot be recalled when a local capture is deleted.\n\nSHA256SUMS covers every payload file including manifest.json; its own digest is not self-listed. The HTTP X-Content-SHA256 header covers the exact ZIP bytes.\n`,
  );
  const captureEvidence = captures.evidence(runId);
  const manifest = {
    ...base,
    ...captureEvidence,
    run: { ...run, humanObservations: [] },
    portable: {
      format: "passage-evidence-zip-v1",
      pathBase: "archive-root",
      privateCaptureContentIncluded: false,
      interactivePreviewsIncluded: false,
      legacyHumanNotesExcluded: true,
    },
    integrity: {
      algorithm: "sha256",
      artifacts: Object.entries(files).map(([name, value]) => ({
        name,
        digest: sha256(Buffer.from(value)),
      })),
    },
  };
  json("manifest.json", portable(manifest));
  add(
    "SHA256SUMS",
    Object.entries(files)
      .map(([path, value]) => `${sha256(Buffer.from(value))}  ${path}`)
      .join("\n") + "\n",
  );
  const content = Buffer.from(zipSync(files, { level: 6 }));
  const artifact = store.artifact(content);
  captures.linkExport(
    captureEvidence.assistiveSessions
      .filter((value) => ["pending", "imported"].includes(value.status))
      .map((value) => value.id),
    artifact.digest,
  );
  return {
    content,
    digest: artifact.digest,
    filename: `passage-${runId}-evidence.zip`,
  };
}
