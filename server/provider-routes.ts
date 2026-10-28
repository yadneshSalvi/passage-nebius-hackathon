import type { LiveProvider } from "../shared/types.js";

export const MODEL = "nvidia/Nemotron-3_5-Lightning";
export const SUPER_MODEL = "nvidia/nemotron-3-super-120b-a12b";
export const NEBIUS_ULTRA_MODEL = "nvidia/Nemotron-3-Ultra-550b-a55b";
export const FIREWORKS_ULTRA_MODEL =
  "accounts/fireworks/models/nemotron-3-ultra-nvfp4";
export const TOGETHER_SUPER_MODEL = "nvidia/NVIDIA-Nemotron-3.5-Super-VL";
export type Pricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};
export interface ModelRoute {
  available: boolean;
  runtimeQualified?: boolean;
  availabilityReason?: string;
  pricing: Pricing | null;
  maxOutputTokens: number;
  timeoutMs: number;
  maxResponseBytes?: number;
  requestFields: Record<string, unknown>;
  servedModelAliases?: string[];
}
export interface ProviderRoute {
  label: string;
  keyEnvironment: string;
  modelEnvironment: string;
  baseEnvironment: string;
  baseUrl: string;
  allowedBaseUrls: string[];
  defaultModel: string;
  models: Record<string, ModelRoute>;
}
const directJsonFields = {
  chat_template_kwargs: { enable_thinking: false },
  response_format: { type: "json_object" },
};
export const MODEL_PRICING: Record<string, Pricing> = Object.freeze({
  [MODEL]: { inputUsdPerMillion: 0.06, outputUsdPerMillion: 0.24 },
  [SUPER_MODEL]: { inputUsdPerMillion: 0.3, outputUsdPerMillion: 0.9 },
  [NEBIUS_ULTRA_MODEL]: { inputUsdPerMillion: 1, outputUsdPerMillion: 3 },
});
/** No provider is a fallback. Catalog membership and confirmed serving compatibility are distinct. */
export const PROVIDER_ROUTES: Record<LiveProvider, ProviderRoute> = {
  nebius: {
    label: "Nebius",
    keyEnvironment: "NEBIUS_API_KEY",
    modelEnvironment: "NEBIUS_MODEL",
    baseEnvironment: "NEBIUS_BASE_URL",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
    allowedBaseUrls: [
      "https://api.tokenfactory.nebius.com/v1",
      "https://api.nebius.com/v1",
      "https://api.studio.nebius.com/v1",
    ],
    defaultModel: MODEL,
    models: Object.fromEntries(
      Object.entries(MODEL_PRICING).map(([model, pricing]) => [
        model,
        {
          available: true,
          runtimeQualified: model !== NEBIUS_ULTRA_MODEL,
          availabilityReason:
            model === NEBIUS_ULTRA_MODEL
              ? "Nebius Ultra is catalog-priced; completion compatibility qualification remains pending."
              : undefined,
          pricing,
          maxOutputTokens: model === NEBIUS_ULTRA_MODEL ? 16000 : 6000,
          timeoutMs: model === NEBIUS_ULTRA_MODEL ? 240000 : 120000,
          requestFields:
            model === NEBIUS_ULTRA_MODEL
              ? {
                  chat_template_kwargs: { enable_thinking: true },
                  response_format: { type: "json_object" },
                }
              : directJsonFields,
        },
      ]),
    ),
  },
  fireworks: {
    label: "Fireworks",
    keyEnvironment: "FIREWORKS_AI_API_KEY",
    modelEnvironment: "FIREWORKS_AI_MODEL",
    baseEnvironment: "FIREWORKS_AI_BASE_URL",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    allowedBaseUrls: ["https://api.fireworks.ai/inference/v1"],
    defaultModel: FIREWORKS_ULTRA_MODEL,
    // HTTP 200 JSON compatibility verified 2026-10-28; high reasoning follows the official configuration. Uncached list prices are conservative.
    // https://fireworks.ai/models/fireworks/nemotron-3-ultra-nvfp4
    // https://docs.fireworks.ai/guides/reasoning.md
    // Prompt schema preserves the documented reasoning profile; content still requires strict local validation.
    // https://docs.fireworks.ai/structured-responses/structured-response-formatting
    models: {
      [FIREWORKS_ULTRA_MODEL]: {
        available: true,
        runtimeQualified: true,
        pricing: { inputUsdPerMillion: 0.6, outputUsdPerMillion: 2.4 },
        maxOutputTokens: 32000,
        timeoutMs: 480000,
        maxResponseBytes: 1048576,
        requestFields: {
          reasoning_effort: "high",
        },
      },
    },
  },
  together: {
    label: "Together",
    keyEnvironment: "TOGETHER_AI_API_KEY",
    modelEnvironment: "TOGETHER_AI_MODEL",
    baseEnvironment: "TOGETHER_AI_BASE_URL",
    baseUrl: "https://api.together.xyz/v1",
    allowedBaseUrls: [
      "https://api.together.xyz/v1",
      "https://api.together.ai/v1",
    ],
    defaultModel: TOGETHER_SUPER_MODEL,
    models: {
      [TOGETHER_SUPER_MODEL]: {
        available: true,
        runtimeQualified: true,
        pricing: { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.5 },
        maxOutputTokens: 16000,
        timeoutMs: 240000,
        requestFields: {
          chat_template_kwargs: { enable_thinking: true },
          response_format: { type: "json_object" },
        },
      },
    },
  },
};
