import { resolve } from "node:path";
import type {
  ConfigurationReference,
  GlobalResource,
  McpServerDeclaration,
  ToolCapabilityResult,
} from "../../../core/types.ts";
import type { AgentToolAdapter } from "./types.ts";
import {
  discoverMcpServersFromConfigs,
  expandHome,
  scanConfigurationsFromCandidates,
  scanInstructionsFromCandidates,
  scanSkillsFromDirectories,
} from "./common.ts";

export const geminiAdapter: AgentToolAdapter = {
  toolId: "gemini",

  async discoverSkills(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const skillDirs: string[] = [];
    for (const r of roots) {
      skillDirs.push(resolve(r, "skills"));
    }
    const defaultDir = expandHome("~/.gemini/skills", home);
    if (!skillDirs.includes(defaultDir)) {
      skillDirs.push(defaultDir);
    }
    return scanSkillsFromDirectories("gemini", skillDirs, roots);
  },

  async discoverSubagents(_roots: string[]): Promise<ToolCapabilityResult<GlobalResource>> {
    return {
      state: "unsupported",
      items: [],
      reason: "Gemini CLI does not provide standalone global sub-agent definition files in V1.",
    };
  },

  async discoverInstructions(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const candidates: string[] = [];
    for (const r of roots) {
      candidates.push(resolve(r, "GEMINI.md"));
    }
    const defaultInst = expandHome("~/.gemini/GEMINI.md", home);
    if (!candidates.includes(defaultInst)) candidates.push(defaultInst);

    return scanInstructionsFromCandidates("gemini", candidates, roots);
  },

  async discoverConfigurations(roots: string[], home?: string): Promise<ConfigurationReference[]> {
    const candidates: string[] = [];
    for (const r of roots) {
      candidates.push(resolve(r, "config.json"));
      candidates.push(resolve(r, "settings.json"));
      candidates.push(resolve(r, "mcp.json"));
    }
    const defaultCfg = expandHome("~/.gemini/config.json", home);
    const defaultSettings = expandHome("~/.gemini/settings.json", home);
    const defaultMcp = expandHome("~/.gemini/mcp.json", home);
    if (!candidates.includes(defaultCfg)) candidates.push(defaultCfg);
    if (!candidates.includes(defaultSettings)) candidates.push(defaultSettings);
    if (!candidates.includes(defaultMcp)) candidates.push(defaultMcp);

    return scanConfigurationsFromCandidates("gemini", candidates);
  },

  async discoverMcpServers(_roots: string[], configs: ConfigurationReference[]): Promise<ToolCapabilityResult<McpServerDeclaration>> {
    return discoverMcpServersFromConfigs("gemini", configs, "jsonc");
  },
};
