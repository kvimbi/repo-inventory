import type { AgentToolId } from "../../../core/types.ts";
import type { AgentToolAdapter } from "./types.ts";
import { codexAdapter } from "./codex.ts";
import { opencodeAdapter } from "./opencode.ts";
import { claudeAdapter } from "./claude.ts";
import { antigravityAdapter } from "./antigravity.ts";
import { geminiAdapter } from "./gemini.ts";

export type { AgentToolAdapter } from "./types.ts";
export { codexAdapter } from "./codex.ts";
export { opencodeAdapter } from "./opencode.ts";
export { claudeAdapter } from "./claude.ts";
export { antigravityAdapter } from "./antigravity.ts";
export { geminiAdapter } from "./gemini.ts";

export const TOOL_ADAPTERS: Record<AgentToolId, AgentToolAdapter> = {
  codex: codexAdapter,
  opencode: opencodeAdapter,
  claude: claudeAdapter,
  antigravity: antigravityAdapter,
  gemini: geminiAdapter,
};
