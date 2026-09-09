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

export const antigravityAdapter: AgentToolAdapter = {
  toolId: "antigravity",

  async discoverSkills(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const skillDirs: string[] = [];
    for (const r of roots) {
      skillDirs.push(resolve(r, "skills"));
    }
    const defaultDir = expandHome("~/.gemini/antigravity/skills", home);
    if (!skillDirs.includes(defaultDir)) {
      skillDirs.push(defaultDir);
    }
    return scanSkillsFromDirectories("antigravity", skillDirs, roots);
  },

  async discoverSubagents(_roots: string[]): Promise<ToolCapabilityResult<GlobalResource>> {
    return {
      state: "unsupported",
      items: [],
      reason:
        "Antigravity sub-agent definitions are managed via internal workspaces and protocol buffers; standalone file format is outside V1 scope.",
    };
  },

  async discoverInstructions(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const candidates: string[] = [];
    for (const r of roots) {
      candidates.push(resolve(r, "instructions.md"));
      candidates.push(resolve(r, "GLOBAL_INSTRUCTIONS.md"));
    }
    const defaultInst = expandHome("~/.gemini/antigravity/instructions.md", home);
    const defaultGlobal = expandHome("~/.gemini/antigravity/GLOBAL_INSTRUCTIONS.md", home);
    if (!candidates.includes(defaultInst)) candidates.push(defaultInst);
    if (!candidates.includes(defaultGlobal)) candidates.push(defaultGlobal);

    return scanInstructionsFromCandidates("antigravity", candidates, roots);
  },

  async discoverConfigurations(roots: string[], home?: string): Promise<ConfigurationReference[]> {
    const candidates: string[] = [];
    for (const r of roots) {
      candidates.push(resolve(r, "config.json"));
      candidates.push(resolve(r, "settings.json"));
    }
    const defaultCfg = expandHome("~/.gemini/antigravity/config.json", home);
    const defaultSettings = expandHome("~/.gemini/antigravity/settings.json", home);
    if (!candidates.includes(defaultCfg)) candidates.push(defaultCfg);
    if (!candidates.includes(defaultSettings)) candidates.push(defaultSettings);

    return scanConfigurationsFromCandidates("antigravity", candidates);
  },

  async discoverMcpServers(_roots: string[], configs: ConfigurationReference[]): Promise<ToolCapabilityResult<McpServerDeclaration>> {
    return discoverMcpServersFromConfigs("antigravity", configs, "jsonc");
  },
};
