import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { LanguageModel } from "ai";
import type { AiProviderName, ModelPreset } from "../core/aiModels.ts";
import {
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_GEMINI_REVIEW_MODEL,
  DEFAULT_BEDROCK_CHAT_MODEL,
  DEFAULT_BEDROCK_REVIEW_MODEL,
  DEFAULT_BEDROCK_REGION,
  GEMINI_MODEL_PRESETS,
  BEDROCK_MODEL_PRESETS,
  BEDROCK_REGION_PRESETS,
} from "../core/aiModels.ts";

export type { AiProviderName, ModelPreset };
export {
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_GEMINI_REVIEW_MODEL,
  DEFAULT_BEDROCK_CHAT_MODEL,
  DEFAULT_BEDROCK_REVIEW_MODEL,
  DEFAULT_BEDROCK_REGION,
  GEMINI_MODEL_PRESETS,
  BEDROCK_MODEL_PRESETS,
  BEDROCK_REGION_PRESETS,
};

export interface ResolveModelOptions {
  provider?: AiProviderName;
  modelId?: string;
  geminiApiKey?: string;
  bedrockApiKey?: string;
  bedrockRegion?: string;
  feature?: "chat" | "review";
}

/**
 * Checks whether credentials exist for the specified AI provider,
 * either in explicit configuration or in process environment variables.
 */
export function hasProviderCredentials(
  provider: AiProviderName,
  options: { geminiApiKey?: string; bedrockApiKey?: string } = {},
): boolean {
  if (provider === "bedrock") {
    const key = options.bedrockApiKey?.trim() || process.env.AWS_BEARER_TOKEN_BEDROCK?.trim();
    return Boolean(key && key.length > 0);
  }
  const key = options.geminiApiKey?.trim() || process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  return Boolean(key && key.length > 0);
}

/**
 * Instantiates the appropriate LanguageModel using Vercel AI SDK providers.
 */
export function resolveLanguageModel(options: ResolveModelOptions): LanguageModel {
  const provider: AiProviderName = options.provider ?? "gemini";

  if (provider === "bedrock") {
    const apiKey = options.bedrockApiKey?.trim() || process.env.AWS_BEARER_TOKEN_BEDROCK?.trim();
    if (!apiKey) {
      throw new Error("Amazon Bedrock API key is not configured. Please configure it in Settings.");
    }
    const region = options.bedrockRegion?.trim() || process.env.AWS_REGION?.trim() || DEFAULT_BEDROCK_REGION;
    const defaultModel =
      options.feature === "review" ? DEFAULT_BEDROCK_REVIEW_MODEL : DEFAULT_BEDROCK_CHAT_MODEL;
    const modelId = options.modelId?.trim() || defaultModel;

    const bedrock = createAmazonBedrock({ apiKey, region });
    return bedrock(modelId);
  }

  const apiKey = options.geminiApiKey?.trim() || process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Gemini API key is not configured. Please configure it in Settings.");
  }
  const defaultModel =
    options.feature === "review" ? DEFAULT_GEMINI_REVIEW_MODEL : DEFAULT_GEMINI_CHAT_MODEL;
  const modelId = options.modelId?.trim() || defaultModel;

  const google = createGoogleGenerativeAI({ apiKey });
  return google(modelId);
}
