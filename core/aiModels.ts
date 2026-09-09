export type AiProviderName = "gemini" | "bedrock";

export const DEFAULT_GEMINI_CHAT_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_REVIEW_MODEL = "gemini-3.8-flash";
export const DEFAULT_BEDROCK_CHAT_MODEL = "anthropic.claude-3-5-sonnet-20241022-v2:0";
export const DEFAULT_BEDROCK_REVIEW_MODEL = "anthropic.claude-3-5-sonnet-20241022-v2:0";
export const DEFAULT_BEDROCK_REGION = "us-east-1";

export interface ModelPreset {
  id: string;
  label: string;
}

export const GEMINI_MODEL_PRESETS: readonly ModelPreset[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (Fast, Recommended)" },
  { id: "gemini-3.8-pro", label: "Gemini 3.8 Pro (Complex reasoning)" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

export const BEDROCK_MODEL_PRESETS: readonly ModelPreset[] = [
  { id: "anthropic.claude-3-5-sonnet-20241022-v2:0", label: "Claude 3.5 Sonnet v2 (Recommended)" },
  { id: "us.anthropic.claude-3-7-sonnet-20250219-v1:0", label: "Claude 3.7 Sonnet (US Profile)" },
  { id: "anthropic.claude-3-5-haiku-20241022-v1:0", label: "Claude 3.5 Haiku (Fast)" },
  { id: "amazon.nova-pro-v1:0", label: "Amazon Nova Pro" },
  { id: "amazon.nova-lite-v1:0", label: "Amazon Nova Lite" },
  { id: "meta.llama3-3-70b-instruct-v1:0", label: "Meta Llama 3.3 70B" },
];

export const BEDROCK_REGION_PRESETS: readonly { id: string; label: string }[] = [
  { id: "us-east-1", label: "us-east-1 (N. Virginia)" },
  { id: "us-west-2", label: "us-west-2 (Oregon)" },
  { id: "eu-central-1", label: "eu-central-1 (Frankfurt)" },
  { id: "eu-west-1", label: "eu-west-1 (Ireland)" },
  { id: "ap-southeast-1", label: "ap-southeast-1 (Singapore)" },
  { id: "ap-northeast-1", label: "ap-northeast-1 (Tokyo)" },
];
