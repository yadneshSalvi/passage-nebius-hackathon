import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FixtureEngine,
  fixtureDefinitions,
  getOriginalSource,
  getReferenceSource,
  validateCandidateSource,
  digest,
} from "../engine/index.js";

describe("scoped component and immutable build boundary", () => {
  let root: string;
  let engine: FixtureEngine;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "passage-engine-"));
    engine = new FixtureEngine({ previewPort: 0, artifactRoot: root });
    await engine.start();
  });
  afterAll(async () => {
    await engine.close();
    await rm(root, { recursive: true, force: true });
  });
  it("accepts all authored original and reference sources without executing them on the host", async () => {
    for (const fixture of fixtureDefinitions) {
      expect(
        validateCandidateSource(await getOriginalSource(fixture.id)),
      ).toEqual({ valid: true, errors: [] });
      expect(
        validateCandidateSource(await getReferenceSource(fixture.id)),
      ).toEqual({ valid: true, errors: [] });
    }
  });
  it("rejects host imports, dynamic execution, protected globals, and HTML injection", async () => {
    const source = await getOriginalSource("northstar-appointments");
    for (const attack of [
      "import fs from 'node:fs';",
      "const value = process.env;",
      "const value = globalThis;",
      "const value = this;",
      'const value = new Function("return 1");',
      "while (true) {}",
      'const value = import("node:fs");',
    ])
      expect(validateCandidateSource(`${attack}\n${source}`).valid).toBe(false);
    expect(
      validateCandidateSource(
        source.replace(
          '<span className="field-label"',
          '<span dangerouslySetInnerHTML={{__html:"<script>evil</script>"}} className="field-label"',
        ),
      ).valid,
    ).toBe(false);
    expect(
      validateCandidateSource(
        source.replace("from 'react'", "from 'https://example.com/x.js'"),
      ).valid,
    ).toBe(false);
  });
  it("does not allow the candidate to supply arbitrary oracle or backend form fields", async () => {
    const source = await getOriginalSource("northstar-appointments");
    expect(
      validateCandidateSource(`${source}\nexport const oracle = () => true;`)
        .valid,
    ).toBe(false);
    expect(
      validateCandidateSource(
        source.replace(
          'className="picker-trigger"',
          'className="picker-trigger" formAction="http://example.com"',
        ),
      ).valid,
    ).toBe(false);
    expect(
      validateCandidateSource(source.replaceAll("slot-trigger", "test-bypass"))
        .valid,
    ).toBe(false);
  });
  it("reports the exact unsupported syntax without widening the source boundary", async () => {
    const source = await getOriginalSource("northstar-appointments");
    const rejected = validateCandidateSource(
      `const choices = [];\nconst last = choices[choices.length - 1];\nwhile (false) {}\n${source}`,
    );
    expect(rejected.valid).toBe(false);
    expect(rejected.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /computed index BinaryExpression at line 2.*local numeric variable/,
        ),
        expect.stringMatching(/WhileStatement at line 3.*handlers and effects/),
      ]),
    );
    expect(
      validateCandidateSource(
        `const choices = []; const index = choices.length - 1; const last = choices[index];\n${source}`,
      ).valid,
    ).toBe(true);
    expect(
      validateCandidateSource(
        `const choices = []; const value = choices['constructor'];\n${source}`,
      ).valid,
    ).toBe(false);
  });
  it("permits literal descendant queries only on a declared React ref, not global, dynamic or aliased queries", async () => {
    const base = (await getOriginalSource("northstar-appointments")).replace(
      "{ useState }",
      "{ useState, useRef }",
    );
    const withQuery = (statement: string) =>
      base.replace(
        "const [open, setOpen]",
        `const panelRef = useRef(null); ${statement}\n  const [open, setOpen]`,
      );
    expect(
      validateCandidateSource(
        withQuery(
          "panelRef.current?.querySelectorAll('button:not([disabled])');",
        ),
      ).valid,
    ).toBe(true);
    expect(
      validateCandidateSource(
        withQuery("panelRef.current?.querySelector('button')?.focus();"),
      ).valid,
    ).toBe(true);
    for (const statement of [
      "document.querySelectorAll('button');",
      "panelRef.current?.ownerDocument.querySelectorAll('button');",
      "panelRef.current?.parentElement.querySelectorAll('button');",
      "const panel = panelRef.current; panel?.querySelectorAll('button');",
      "const select = panelRef.current?.querySelectorAll; select('button');",
      "const selector = 'button'; panelRef.current?.querySelectorAll(selector);",
      "const other = {}; other.current?.querySelectorAll('button');",
      "panelRef.current?.['querySelectorAll']('button');",
    ])
      expect(validateCandidateSource(withQuery(statement)).valid).toBe(false);
    const alias = validateCandidateSource(withQuery("const panel = panelRef.current; panel?.querySelectorAll('button');"));
    expect(alias.errors.join(' ')).toContain("panel?.querySelectorAll('button')");
    expect(alias.errors.join(' ')).toMatch(/line \d+, column \d+/);
    expect(alias.errors.join(' ')).toContain("ref.current.querySelectorAll('static selector')");
    expect(alias.errors.join(' ')).toContain('Aliases, dynamic selectors');
  });
  it("content-binds builds to source, immutable assets, and the installed toolchain", async () => {
    const source = await getOriginalSource("northstar-appointments");
    const build = await engine.prepareBuild({
      fixtureId: "northstar-appointments",
      source,
    });
    expect(build.digest).toBe(digest(source));
    expect(build.toolchainDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      (
        await engine.prepareBuild({
          fixtureId: "northstar-appointments",
          source,
        })
      ).id,
    ).toBe(build.id);
    const bundlePath = join(root, "builds", build.id, "bundle.js");
    const original = await readFile(bundlePath);
    await writeFile(bundlePath, "corrupted");
    await expect(engine.getBuild(build.id)).rejects.toThrow(/integrity/);
    await writeFile(bundlePath, original);
    expect((await engine.getBuild(build.id)).bundleDigest).toBe(
      digest(original),
    );
  });
  it("serves previews on an isolated origin without eval or external-network CSP allowance", async () => {
    const build = await engine.prepareBuild({
      fixtureId: "northstar-appointments",
      source: await getOriginalSource("northstar-appointments"),
    });
    const response = await fetch(build.previewUrl);
    const policy = response.headers.get("content-security-policy")!;
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("unsafe-inline");
    const denied = await fetch(`${response.url}/appointments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:4101",
      },
      body: JSON.stringify({ date: "2026-11-16", attendee: "Alex Morgan" }),
    });
    expect(denied.status).toBe(403);
  });
});
