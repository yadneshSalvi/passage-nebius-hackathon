import { z } from "zod";
import { parse as parseModule } from "@babel/parser";
import type { GenerationFailure, ModelReceipt } from "../shared/types.js";
import { AppError, Store, id, now, sha256, type UsageEntry } from "./store.js";

export const REPAIR_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 4000 },
    source: { type: "string", minLength: 40, maxLength: 60000 },
  },
  required: ["summary", "source"],
};
const schema = z
  .object({
    summary: z.string().min(1).max(4000),
    source: z.string().min(40).max(60000),
  })
  .strict();
export class GenerationOutputError extends AppError {
  constructor(readonly failure: GenerationFailure) {
    super(failure.code, failure.message, 502);
  }
}

/** Store only message.content, which stays untrusted and may contain explanatory/non-JSON text. Never pass reasoning_content. */
export interface FinalOutputInput {
  content: unknown;
  finishReason?: string;
  refusal?: string;
  store: Store;
  entry: UsageEntry;
  receipt: ModelReceipt;
}
export function parseFinalComponent(input: FinalOutputInput): { summary: string; source: string } {
  return parseFinalStructured(input, schema);
}

/** Both protocols capture only bounded final content, never reasoning_content. */
function readFinalContent(input: FinalOutputInput) {
  const { store, entry, receipt } = input;
  let outputArtifact: GenerationFailure["outputArtifact"];
  if (typeof input.content === "string") {
    const full = Buffer.from(input.content, "utf8");
    const captured = full.subarray(0, 128000);
    const artifact = store.artifact(captured);
    entry.finalOutputDigest = artifact.digest;
    receipt.finalOutputDigest = artifact.digest;
    outputArtifact = {
      name: "final-message-content.txt",
      digest: artifact.digest,
      url: `/v1/artifacts/${artifact.digest}`,
      mediaType: "text/plain",
      byteLength: full.byteLength,
      capturedBytes: captured.byteLength,
      captureTruncated: captured.byteLength !== full.byteLength,
    };
  }
  let topLevelKeys: string[] = [];
  const fail = (
    code: GenerationFailure["code"],
    message: string,
    diagnostics: GenerationFailure["diagnostics"],
  ): never => {
    throw new GenerationOutputError({
      id: id("generation-failure"),
      runId: entry.runId,
      usageEntryId: entry.id,
      createdAt: now(),
      code,
      message,
      receipt,
      diagnostics,
      topLevelKeys,
      ...(outputArtifact ? { outputArtifact } : {}),
    });
  };
  if (input.finishReason === "length")
    fail(
      "MODEL_TRUNCATED",
      "The provider reached its output allowance. Final content is retained for review and was not executed.",
      [
        {
          path: "$",
          code: "output_limit",
          message: "Provider reported finish_reason=length.",
        },
      ],
    );
  if (input.refusal || typeof input.content !== "string" || !input.content)
    fail(
      "MODEL_REFUSAL",
      "The provider did not return final structured content. Nothing was executed.",
      [
        {
          path: "$",
          code: "missing_final_content",
          message: "Expected a nonempty final message.content string.",
        },
      ],
    );
  return { content: input.content as string, fail, recordKeys(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value))
      topLevelKeys = Object.keys(value).slice(0, 20).map(key => key.slice(0, 80));
  } };
}

/** The same bounded final-content receipt and strict validation serve compiler and patch decisions. */
export function parseFinalStructured<T>(input: FinalOutputInput, outputSchema: z.ZodType<T>): T {
  const { content, fail, recordKeys } = readFinalContent(input);
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    fail(
      "MALFORMED_MODEL_OUTPUT",
      "The final content was not valid JSON. Inspect the retained output artifact; nothing was executed.",
      [
        {
          path: "$",
          code: "invalid_json",
          message:
            "Expected one JSON object matching the requested structured schema.",
        },
      ],
    );
  }
  recordKeys(value);
  const parsed = outputSchema.safeParse(value);
  if (!parsed.success)
    return fail(
      "MALFORMED_MODEL_OUTPUT",
      "The final JSON did not match the requested schema. Inspect the public field diagnostics and retained content; nothing was executed.",
      parsed.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.length
          ? issue.path.map(String).join(".").slice(0, 160)
          : "$",
        code: issue.code,
        message: issue.message.slice(0, 300),
      })),
    );
  return parsed.data;
}

/** One complete module, optionally wrapped in exactly one code fence. No prose extraction or source repair. */
export function parseFinalSingleSource(input: FinalOutputInput): { source: string } {
  const { content, fail } = readFinalContent(input);
  const trimmed = content.trim();
  let source = content;
  if (trimmed.startsWith("```")) {
    const fence = /^```(?:jsx|javascript|js)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed);
    if (!fence) return fail("MALFORMED_MODEL_OUTPUT", "The final source must be one complete JSX module or one exact code fence. Nothing was executed.",
      [{ path: "$", code: "invalid_source_envelope", message: "Only raw JavaScript JSX or a single jsx/javascript/js code fence is supported; surrounding prose is not extracted." }]);
    source = fence[1];
  }
  if (source.length < 40 || source.length > 60000)
    return fail("MALFORMED_MODEL_OUTPUT", "The final source exceeds the bounded single-file output format. Nothing was executed.",
      [{ path: "source", code: "source_size", message: "A complete source module must contain 40–60000 characters; the adapter's stricter admission bounds also apply." }]);
  try { parseModule(source, { sourceType: "module", plugins: ["jsx"] }); }
  catch (error) {
    const location = (error as { loc?: { line?: number; column?: number } }).loc;
    return fail("MALFORMED_MODEL_OUTPUT", "The final content was not a complete JavaScript JSX module. Nothing was executed.",
      [{ path: location ? `source:${location.line}:${location.column}` : "source", code: "invalid_jsx",
        message: `Expected a complete syntactically valid JavaScript JSX module. Parser: ${error instanceof Error ? error.message.slice(0, 500) : "Invalid source syntax."}` }]);
  }
  return { source };
}

/** Bounded diagnostics for rejected bytes, never a patch or an execution input. */
export function retainedFailureFeedback(store: Store, failure: GenerationFailure, inspectedSourceDigest: string) {
  const base = { id: failure.id, code: failure.code, message: failure.message, promptVersion: failure.receipt.promptVersion,
    diagnostics: failure.diagnostics, topLevelKeys: failure.topLevelKeys,
    rejectedOutputDigest: failure.outputArtifact?.digest ?? null, inspectedSourceDigest };
  const position = failure.diagnostics?.find(item => item.code === "invalid_jsx")?.path.match(/^source:(\d+):(\d+)$/);
  if (failure.receipt.outputProtocol !== "single-source" || !failure.outputArtifact || !position) return base;
  try {
    const bytes = store.readArtifact(failure.outputArtifact.digest);
    if (bytes.byteLength > 128000 || sha256(bytes) !== failure.outputArtifact.digest) return { ...base, rejectedExcerptUnavailable: "Stored final-output identity could not be verified within the capture bound." };
    const raw = bytes.toString("utf8"), fence = /^```(?:jsx|javascript|js)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(raw.trim());
    const moduleText = fence ? fence[1] : raw, lines = moduleText.split("\n"), line = Number(position[1]);
    if (line < 1 || line > lines.length) return { ...base, rejectedExcerptUnavailable: "The reported location is outside the retained output." };
    let parserDiagnostic = "The retained module now parses; its historical rejection remains unchanged.";
    try { parseModule(moduleText, { sourceType: "module", plugins: ["jsx"] }); }
    catch (error) { parserDiagnostic = error instanceof Error ? error.message.slice(0, 500) : "Invalid source syntax."; }
    const startLine = Math.max(1, line - 8), endLine = Math.min(lines.length, line + 3);
    return { ...base, rejectedSourceExcerpt: {
      interpretation: "These line numbers refer only to the retained rejected module, which was never executed or admitted as the inspected source. Do not confuse its bytes with inspectedSourceDigest.",
      moduleDigest: sha256(moduleText), moduleWasFenced: Boolean(fence), startLine, endLine,
      lines: lines.slice(startLine - 1, endLine).map((text, index) => ({ line: startLine + index, text: text.slice(0, 180), truncated: text.length > 180 })),
      readOnlyReparseDiagnostic: parserDiagnostic, historicalDiagnosticUnchanged: true,
    } };
  } catch {
    return { ...base, rejectedExcerptUnavailable: "The retained artifact is unavailable; no source or diagnostic was reconstructed." };
  }
}
