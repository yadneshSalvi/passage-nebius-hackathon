/** Synthetic transport fixtures: no live inference or generated-source execution. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepairProvider, NEBIUS_ULTRA_MODEL, SUPER_MODEL } from "../server/provider.js";
import { GenerationOutputError, retainedFailureFeedback } from "../server/generation-output.js";
import { Store, sha256 } from "../server/store.js";

let root: string, store: Store;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "passage-source-protocol-unit-")); store = new Store(root); });
afterEach(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
const source = String.raw`import React from "react";
export default function Example({ value }) {
  const compact = value.replace(/\s+/g, " ");
  return <button>{compact}</button>;
}`;
const input = () => ({ runId: "unit-source", signal: new AbortController().signal,
  promptVersion: "synthetic-source-protocol-unit", system: "Return one complete module", payload: { source } });
function response(content: unknown, finishReason = "stop", reasoningContent = "") {
  return new Response(JSON.stringify({ model: NEBIUS_ULTRA_MODEL, id: "synthetic-only", usage: { prompt_tokens: 10, completion_tokens: 10 },
    choices: [{ finish_reason: finishReason, message: { content, reasoning_content: reasoningContent } }] }));
}
function provider(fetcher: typeof fetch, model = NEBIUS_ULTRA_MODEL) {
  return new RepairProvider(store, { provider: "nebius", model, baseUrl: "https://api.tokenfactory.us-central1.nebius.com/v1",
    apiKey: "unit-secret", allowLive: true, nebiusBudgetUsd: 2, fetch: fetcher });
}

describe("strict single-file source output", () => {
  it("preserves raw backslashes and binds the exact final-content artifact for raw or single-fenced JSX", async () => {
    for (const content of [source, "```jsx\n" + source + "\n```\n"]) {
      const fake = vi.fn(async () => response(content)), route = provider(fake as typeof fetch);
      expect(route.singleSourceOutputAvailable).toBe(true);
      const result = await route.completeSingleSource(input());
      expect(result.source).toBe(source);
      expect(result.receipt).toMatchObject({ outputProtocol: "single-source", finalOutputDigest: sha256(content), temperature: 1 });
      expect(store.readArtifact(result.receipt.finalOutputDigest!).toString()).toBe(content);
      expect(store.usage().at(-1)).toMatchObject({ outputProtocol: "single-source", completionQualified: true });
    }
  });
  it("retains and rejects prose, JSON wrapping, multiple fences, invalid syntax and oversized source", async () => {
    for (const content of ["Here is the source:\n" + source, JSON.stringify({ source }),
      "```jsx\n" + source + "\n```\nExplanation", "```jsx\n" + source + "\n```\n```jsx\n" + source + "\n```",
      "export default function Broken() { return <button>Missing closing element; }", " ".repeat(60001)]) {
      const route = provider(vi.fn(async () => response(content)) as typeof fetch);
      let error: unknown; try { await route.completeSingleSource(input()); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(GenerationOutputError);
      expect((error as GenerationOutputError).failure).toMatchObject({ code: "MALFORMED_MODEL_OUTPUT", receipt: { outputProtocol: "single-source" }, outputArtifact: { digest: sha256(content) } });
      expect(store.usage().at(-1)?.completionQualified).not.toBe(true);
    }
  });
  it("never substitutes reasoning content or a length-limited final module", async () => {
    const missing = provider(vi.fn(async () => response("", "stop", source)) as typeof fetch);
    await expect(missing.completeSingleSource(input())).rejects.toMatchObject({ code: "MODEL_REFUSAL" });
    const truncated = provider(vi.fn(async () => response(source, "length")) as typeof fetch);
    await expect(truncated.completeSingleSource(input())).rejects.toMatchObject({ code: "MODEL_TRUNCATED" });
    expect(store.usage().every(entry => !entry.completionQualified)).toBe(true);
  });
  it("binds rejected syntax excerpts to their own immutable output instead of the inspected revision", async () => {
    const rejected = 'export default function Broken() {\n  const duplicate = 1;\n  const duplicate = 2;\n  return <button>{duplicate}</button>;\n}';
    for (const content of [rejected, '```jsx\n' + rejected + '\n```']) {
      const route = provider(vi.fn(async () => response(content)) as typeof fetch);
      let failure: GenerationOutputError | undefined;
      try { await route.completeSingleSource(input()); } catch (error) { failure = error as GenerationOutputError; }
      expect(failure).toBeInstanceOf(GenerationOutputError);
      const original = structuredClone(failure!.failure);
      expect(original.diagnostics[0].message).toContain('already been declared');
      const feedback = retainedFailureFeedback(store, original, sha256(source));
      expect(feedback).toMatchObject({ rejectedOutputDigest: sha256(content), inspectedSourceDigest: sha256(source),
        rejectedSourceExcerpt: { moduleDigest: sha256(rejected), startLine: 1, endLine: 5, historicalDiagnosticUnchanged: true } });
      expect('rejectedSourceExcerpt' in feedback && feedback.rejectedSourceExcerpt?.lines[2]).toMatchObject({ line: 3, text: '  const duplicate = 2;' });
      expect(original).toEqual(failure!.failure); expect(store.readArtifact(sha256(content)).toString()).toBe(content);
    }
  });
  it("preserves JSON-mode routes without an implicit output-mode or provider change", () => {
    const fake = vi.fn(async () => response(source)), route = provider(fake as typeof fetch, SUPER_MODEL);
    expect(route.singleSourceOutputAvailable).toBe(false);
    expect(() => route.completeSingleSource(input())).toThrow(/requires structured JSON/);
    expect(fake).not.toHaveBeenCalled(); expect(store.usage()).toEqual([]);
  });
});
