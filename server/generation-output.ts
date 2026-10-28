import { z } from "zod";
import type { GenerationFailure, ModelReceipt } from "../shared/types.js";
import { AppError, Store, id, now, type UsageEntry } from "./store.js";

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
export function parseFinalComponent(input: {
  content: unknown;
  finishReason?: string;
  refusal?: string;
  store: Store;
  entry: UsageEntry;
  receipt: ModelReceipt;
}): { summary: string; source: string } {
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
      "The provider did not return a final repair component. Nothing was executed.",
      [
        {
          path: "$",
          code: "missing_final_content",
          message: "Expected a nonempty final message.content string.",
        },
      ],
    );
  let value: unknown;
  try {
    value = JSON.parse(input.content as string);
  } catch {
    fail(
      "MALFORMED_MODEL_OUTPUT",
      "The final content was not valid JSON. Inspect the retained output artifact; nothing was executed.",
      [
        {
          path: "$",
          code: "invalid_json",
          message:
            "Expected one JSON object containing string fields summary and source.",
        },
      ],
    );
  }
  if (value && typeof value === "object" && !Array.isArray(value))
    topLevelKeys = Object.keys(value)
      .slice(0, 20)
      .map((key) => key.slice(0, 80));
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    return fail(
      "MALFORMED_MODEL_OUTPUT",
      "The final JSON did not match the repair schema. Inspect the public field diagnostics and retained content; nothing was executed.",
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
