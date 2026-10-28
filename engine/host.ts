import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import {
  mkdir,
  readFile,
  writeFile,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";
import type { BackendOutcome, Scenario } from "../shared/types.js";
import {
  digest,
  effectiveScenario,
  getFixture,
  scenarioDefinitions,
} from "./catalog.js";
import { validateCandidateSource } from "./safety.js";

export interface FixtureBuild {
  id: string;
  digest: string;
  fixtureId: string;
  source: string;
  sourceFile: string;
  previewUrl: string;
  bundleDigest: string;
  cssDigest: string;
  toolchainDigest: string;
}
export interface Choice {
  date: string;
  label: string;
  day: string;
  weekday: string;
  unavailable: boolean;
}
export interface FixtureSession {
  id: string;
  buildId: string;
  fixtureId: string;
  sourceDigest: string;
  scenario: Scenario;
  choices: Choice[];
  createdAt: string;
  outcome: BackendOutcome | null;
  rejectedDates: string[];
  validatedDates: string[];
  availabilityChecks: number;
}
export interface StoredArtifact {
  name: string;
  digest: string;
  url: string;
  mediaType: string;
}

const shellPath = fileURLToPath(
  new URL("../fixtures/host.tsx", import.meta.url),
);
const cssPath = fileURLToPath(new URL("../fixtures/host.css", import.meta.url));
const validDigest = /^[a-f0-9]{64}$/;
const validSessionId = /^[a-f0-9-]{36}$/;
const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
};
const delay = (milliseconds: number) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function choicesFor(scenario: Scenario): Choice[] {
  return Array.from({ length: 10 }, (_, index) => {
    const day = 16 + index;
    const date = `2026-11-${day}`;
    const label = new Intl.DateTimeFormat(
      scenario.locale === "de" ? "de-DE" : "en-GB",
      { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" },
    ).format(new Date(`${date}T12:00:00Z`));
    return {
      date,
      label: scenario.longLabels
        ? `${label} · ${scenario.locale === "de" ? "Persönliche Beratung und weiterführende Unterstützung" : "Personal consultation and continuing support"}`
        : label,
      day: String(day),
      weekday: label.split(" ")[0],
      unavailable:
        index === 4 ||
        index === 7 ||
        (scenario.unavailableFirst && index === 0),
    };
  });
}

export class FixtureHost {
  readonly root: string;
  previewPort: number;
  private server?: Server;
  private builds = new Map<string, FixtureBuild>();
  private sessions = new Map<string, FixtureSession>();
  constructor(options: { previewPort?: number; artifactRoot?: string } = {}) {
    this.previewPort =
      options.previewPort ?? Number(process.env.PASSAGE_PREVIEW_PORT || 4103);
    this.root = resolve(options.artifactRoot ?? ".passage/engine");
  }
  get origin() {
    return `http://127.0.0.1:${this.previewPort}`;
  }

  async start() {
    if (this.server) return;
    await Promise.all(
      ["builds", "sessions", "artifacts"].map((name) =>
        mkdir(join(this.root, name), { recursive: true }),
      ),
    );
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent)
          json(response, 500, {
            error: "The fixture could not complete this request.",
          });
        else response.end();
      });
    });
    await new Promise<void>((ok, fail) => {
      this.server!.once("error", fail);
      this.server!.listen(this.previewPort, "127.0.0.1", () => {
        this.server!.off("error", fail);
        ok();
      });
    });
    const address = this.server.address();
    if (address && typeof address === "object") this.previewPort = address.port;
  }

  async close() {
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise<void>((ok) => this.server!.close(() => ok()));
      this.server = undefined;
    }
  }

  async prepareBuild(options: {
    fixtureId: string;
    source: string;
  }): Promise<FixtureBuild> {
    const fixture = getFixture(options.fixtureId);
    const safety = validateCandidateSource(options.source);
    if (!safety.valid)
      throw new Error(`Source validation rejected: ${safety.errors.join(" ")}`);
    const [shell, css, lockfile] = await Promise.all([
      readFile(shellPath, "utf8"),
      readFile(cssPath, "utf8"),
      readFile(resolve("package-lock.json"), "utf8"),
    ]);
    const sourceDigest = digest(options.source);
    const toolchainDigest = digest(
      JSON.stringify({
        lockfile: digest(lockfile),
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      }),
    );
    const id = digest(
      JSON.stringify({
        adapter: "passage-react-component-v1",
        sourceDigest,
        shellDigest: digest(shell),
        cssDigest: digest(css),
        fixtureId: fixture.id,
        toolchainDigest,
      }),
    );
    if (this.builds.has(id)) return this.getBuild(id);
    const buildDirectory = join(this.root, "builds", id);
    const existing = await this.getBuild(id).catch(() => null);
    if (existing) return existing;
    const output = await bundle({
      entryPoints: [shellPath],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      target: "es2020",
      jsx: "automatic",
      minify: true,
      legalComments: "none",
      define: { "process.env.NODE_ENV": '"production"' },
      logLevel: "silent",
      plugins: [
        {
          name: "scoped-fixture-source",
          setup(builder) {
            builder.onResolve({ filter: /^@fixture\/slot$/ }, () => ({
              path: "SlotControl.jsx",
              namespace: "scoped-fixture",
            }));
            builder.onLoad(
              { filter: /.*/, namespace: "scoped-fixture" },
              () => ({
                contents: options.source,
                loader: "jsx",
                resolveDir: resolve("."),
              }),
            );
          },
        },
      ],
    });
    const javascript = output.outputFiles[0].text;
    const build: FixtureBuild = {
      id,
      fixtureId: fixture.id,
      digest: sourceDigest,
      source: options.source,
      sourceFile: fixture.sourceFile,
      previewUrl: `${this.origin}/preview/${id}`,
      bundleDigest: digest(javascript),
      cssDigest: digest(css),
      toolchainDigest,
    };
    const temporary = await mkdtemp(join(this.root, "builds", ".building-"));
    try {
      await Promise.all([
        writeFile(join(temporary, "bundle.js"), javascript, { flag: "wx" }),
        writeFile(join(temporary, "style.css"), css, { flag: "wx" }),
        writeFile(
          join(temporary, "manifest.json"),
          JSON.stringify(build, null, 2),
          { flag: "wx" },
        ),
      ]);
      await rename(temporary, buildDirectory);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    this.builds.set(id, build);
    return build;
  }

  async getBuild(id: string): Promise<FixtureBuild> {
    if (!validDigest.test(id)) throw new Error("Unknown immutable build.");
    const cached = this.builds.get(id);
    const build: FixtureBuild =
      cached ??
      JSON.parse(
        await readFile(join(this.root, "builds", id, "manifest.json"), "utf8"),
      );
    if (build.id !== id || digest(build.source) !== build.digest)
      throw new Error("The stored build failed its source integrity check.");
    const [javascript, css] = await Promise.all([
      readFile(join(this.root, "builds", id, "bundle.js")),
      readFile(join(this.root, "builds", id, "style.css")),
    ]);
    if (
      digest(javascript) !== build.bundleDigest ||
      digest(css) !== build.cssDigest
    )
      throw new Error("The stored build failed its asset integrity check.");
    build.previewUrl = `${this.origin}/preview/${id}`;
    this.builds.set(id, build);
    return build;
  }

  async createSession(
    build: FixtureBuild,
    requestedScenario: Scenario,
  ): Promise<FixtureSession> {
    const scenario = effectiveScenario(build.fixtureId, requestedScenario);
    const session: FixtureSession = {
      id: randomUUID(),
      buildId: build.id,
      fixtureId: build.fixtureId,
      sourceDigest: build.digest,
      scenario,
      choices: choicesFor(scenario),
      createdAt: new Date().toISOString(),
      outcome: null,
      rejectedDates: [],
      validatedDates: [],
      availabilityChecks: 0,
    };
    await this.saveSession(session);
    return session;
  }

  async getSession(id: string): Promise<FixtureSession> {
    if (!validSessionId.test(id))
      throw new Error("Unknown appointment session.");
    const existing = this.sessions.get(id);
    const session: FixtureSession =
      existing ??
      JSON.parse(
        await readFile(join(this.root, "sessions", `${id}.json`), "utf8"),
      );
    session.validatedDates ??= [];
    if (Date.now() - Date.parse(session.createdAt) > 30 * 24 * 3600 * 1000)
      throw new Error(
        "This preview session expired. Open a new preview from its build.",
      );
    this.sessions.set(id, session);
    return session;
  }

  private async saveSession(session: FixtureSession) {
    this.sessions.set(session.id, session);
    await writeFile(
      join(this.root, "sessions", `${session.id}.json`),
      JSON.stringify(session, null, 2),
      { mode: 0o600 },
    );
  }

  async submitAppointment(
    sessionId: string,
    body: unknown,
  ): Promise<{ status: number; appointment?: BackendOutcome; error?: string }> {
    const session = await this.getSession(sessionId);
    const request = body as { date?: unknown; attendee?: unknown };
    if (
      !request ||
      typeof request.date !== "string" ||
      typeof request.attendee !== "string" ||
      !request.attendee.trim() ||
      request.attendee.length > 80
    )
      return {
        status: 422,
        error: "A valid appointment date and name are required.",
      };
    const choice = session.choices.find((item) => item.date === request.date);
    if (
      !choice ||
      choice.unavailable ||
      session.rejectedDates.includes(request.date)
    )
      return {
        status: 422,
        error: "This appointment is not available. Please choose another date.",
      };
    if (
      getFixture(session.fixtureId).family === "async-validation" &&
      !session.validatedDates.includes(request.date)
    )
      return {
        status: 422,
        error:
          "Please check this appointment’s availability before confirming.",
      };
    await delay(session.scenario.delayedValidationMs);
    if (session.outcome) {
      if (
        session.outcome.date !== request.date ||
        session.outcome.attendee !== request.attendee.trim()
      )
        return {
          status: 409,
          error:
            "This session already has a confirmed appointment. Start a new preview to book again.",
        };
      return { status: 200, appointment: session.outcome };
    }
    const outcome: BackendOutcome = {
      id: randomUUID(),
      sessionId,
      date: request.date,
      attendee: request.attendee.trim(),
      service: session.fixtureId,
      sourceDigest: session.sourceDigest,
      createdAt: new Date().toISOString(),
    };
    session.outcome = outcome;
    await this.saveSession(session);
    return { status: 201, appointment: outcome };
  }

  async putArtifact(
    name: string,
    content: string | Buffer,
    mediaType: string,
  ): Promise<StoredArtifact> {
    const hash = digest(content);
    const extension =
      mediaType === "image/png"
        ? "png"
        : mediaType === "text/plain"
          ? "txt"
          : "json";
    await writeFile(
      join(this.root, "artifacts", `${hash}.${extension}`),
      content,
      { flag: "wx" },
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    return {
      name,
      digest: hash,
      url: `${this.origin}/artifacts/${hash}.${extension}`,
      mediaType,
    };
  }

  private async body(request: IncomingMessage) {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8192) throw new Error("Request too large.");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const allowedHosts = new Set([
      `127.0.0.1:${this.previewPort}`,
      `localhost:${this.previewPort}`,
    ]);
    if (!allowedHosts.has(request.headers.host ?? "")) {
      json(response, 403, { error: "Unknown preview host." });
      return;
    }
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    const url = new URL(request.url ?? "/", this.origin);
    if (
      request.method === "POST" &&
      ((request.headers.origin &&
        request.headers.origin !== this.origin &&
        request.headers.origin !== `http://localhost:${this.previewPort}`) ||
        !request.headers["content-type"]?.startsWith("application/json"))
    ) {
      json(response, 403, {
        error: "Preview writes are restricted to this isolated origin.",
      });
      return;
    }
    if (url.pathname === "/health") {
      json(response, 200, { status: "ok", adapter: "scoped-react-v1" });
      return;
    }
    const preview = /^\/preview\/([a-f0-9]{64})$/.exec(url.pathname);
    if (preview && request.method === "GET") {
      const build = await this.getBuild(preview[1]);
      const scenario =
        scenarioDefinitions.find(
          (item) => item.id === url.searchParams.get("scenario"),
        ) ?? scenarioDefinitions[0];
      const session = await this.createSession(build, scenario);
      response.writeHead(302, {
        Location: `/s/${session.id}`,
        "Cache-Control": "no-store",
      });
      response.end();
      return;
    }
    const bundleRequest =
      /^\/b\/([a-f0-9]{64})\/(bundle\.js|style\.css|receipt)$/.exec(
        url.pathname,
      );
    if (bundleRequest && request.method === "GET") {
      const build = await this.getBuild(bundleRequest[1]);
      if (bundleRequest[2] === "receipt") {
        json(response, 200, {
          schemaVersion: "1.0",
          buildId: build.id,
          sourceDigest: build.digest,
          bundleDigest: build.bundleDigest,
          cssDigest: build.cssDigest,
          toolchainDigest: build.toolchainDigest,
          fixtureId: build.fixtureId,
          sourceFile: build.sourceFile,
          isolation:
            "Separate loopback origin; scoped JSX compilation; no model source executed by Node.",
        });
        return;
      }
      const content = await readFile(
        join(this.root, "builds", build.id, bundleRequest[2]),
      );
      if (
        bundleRequest[2] === "bundle.js" &&
        digest(content) !== build.bundleDigest
      )
        throw new Error("Bundle integrity mismatch.");
      response.writeHead(200, {
        "Content-Type": bundleRequest[2].endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      response.end(content);
      return;
    }
    const artifactRequest =
      /^\/artifacts\/([a-f0-9]{64})\.(json|png|txt)$/.exec(url.pathname);
    if (artifactRequest && request.method === "GET") {
      const content = await readFile(
        join(
          this.root,
          "artifacts",
          `${artifactRequest[1]}.${artifactRequest[2]}`,
        ),
      );
      if (digest(content) !== artifactRequest[1])
        throw new Error("Artifact integrity mismatch.");
      response.writeHead(200, {
        "Content-Type":
          artifactRequest[2] === "png"
            ? "image/png"
            : artifactRequest[2] === "txt"
              ? "text/plain; charset=utf-8"
              : "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "http://127.0.0.1:4101",
      });
      response.end(content);
      return;
    }
    const sessionRequest =
      /^\/s\/([a-f0-9-]{36})(?:\/(appointments|availability|receipt))?$/.exec(
        url.pathname,
      );
    if (sessionRequest) {
      const session = await this.getSession(sessionRequest[1]);
      if (request.method === "POST" && sessionRequest[2] === "appointments") {
        const result = await this.submitAppointment(
          session.id,
          await this.body(request),
        );
        json(response, result.status, result);
        return;
      }
      if (request.method === "POST" && sessionRequest[2] === "availability") {
        const body = await this.body(request);
        if (
          typeof body.date !== "string" ||
          !session.choices.some((choice) => choice.date === body.date)
        ) {
          json(response, 422, { error: "Choose a known appointment." });
          return;
        }
        const choice = session.choices.find((item) => item.date === body.date)!;
        const firstLateError =
          getFixture(session.fixtureId).family === "async-validation" &&
          session.availabilityChecks === 0;
        session.availabilityChecks += 1;
        if (firstLateError && !session.rejectedDates.includes(choice.date))
          session.rejectedDates.push(choice.date);
        await this.saveSession(session);
        await delay(session.scenario.delayedValidationMs);
        const available =
          !choice.unavailable && !session.rejectedDates.includes(choice.date);
        if (available && !session.validatedDates.includes(choice.date)) {
          session.validatedDates.push(choice.date);
          await this.saveSession(session);
        }
        json(response, 200, {
          available,
          reason: available
            ? undefined
            : session.scenario.locale === "de"
              ? "Dieser Termin wurde gerade vergeben. Bitte wählen Sie einen anderen Termin."
              : "That time was just taken. Please choose another appointment.",
        });
        return;
      }
      if (request.method === "GET" && sessionRequest[2] === "receipt") {
        json(response, 200, {
          buildId: session.buildId,
          sourceDigest: session.sourceDigest,
          scenario: session.scenario,
          outcome: session.outcome,
        });
        return;
      }
      if (request.method === "GET" && !sessionRequest[2]) {
        const build = await this.getBuild(session.buildId);
        const config = JSON.stringify({
          sessionId: session.id,
          fixture: getFixture(session.fixtureId),
          choices: session.choices,
          scenario: session.scenario,
          sourceDigest: session.sourceDigest,
          outcome: session.outcome,
        }).replaceAll("<", "\\u003c");
        const nonce = randomUUID();
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors http://127.0.0.1:4101 http://localhost:4101;`,
        });
        response.end(
          `<!doctype html><html lang="${session.scenario.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${getFixture(session.fixtureId).organization} · Appointment</title><link rel="stylesheet" href="/b/${build.id}/style.css"></head><body><div id="root"></div><script type="application/json" id="fixture-config" nonce="${nonce}">${config}</script><script nonce="${nonce}" src="/b/${build.id}/bundle.js"></script></body></html>`,
        );
        return;
      }
    }
    json(response, 404, {
      error:
        "This preview resource does not exist. Open the application from Passage.",
    });
  }
}
