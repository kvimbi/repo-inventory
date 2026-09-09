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

export const claudeAdapter: AgentToolAdapter = {
  toolId: "claude",

  async discoverSkills(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const skillDirs: string[] = [];
    for (const r of roots) {
      skillDirs.push(resolve(r, "skills"));
    }
    const defaultDir = expandHome("~/.claude/skills", home);
    if (!skillDirs.includes(defaultDir)) {
      skillDirs.push(defaultDir);
    }
    return scanSkillsFromDirectories("claude", skillDirs, roots);
  },

  async discoverSubagents(_roots: string[]): Promise<ToolCapabilityResult<GlobalResource>> {
    return {
      state: "unsupported",
      items: [],
      reason: "Claude Code does not define standalone global sub-agent definition files in V1.",
    };
  },

  async discoverInstructions(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const candidates: string[] = [];
    for (const r of roots) {
      candidates.push(resolve(r, "CLAUDE.md"));
    }
    const defaultInst = expandHome("~/.claude/CLAUDE.md", home);
    if (!candidates.includes(defaultInst)) candidates.push(defaultInst);

    return scanInstructionsFromCandidates("claude", candidates, roots);
  },

  async discoverConfigurations(roots: string[], home?: string): Promise<ConfigurationReference[]> {
    const candidates: string[] = [
      expandHome("~/.claude.json", home),
      expandHome("~/Library/Application Support/Claude/claude_desktop_config.json", home),
    ];
    for (const r of roots) {
      const cfgPath = resolve(r, "claude_desktop_config.json");
      if (!candidates.includes(cfgPath)) candidates.push(cfgPath);
    }
    return scanConfigurationsFromCandidates("claude", candidates);
  },

  async discoverMcpServers(_roots: string[], configs: ConfigurationReference[]): Promise<ToolCapabilityResult<McpServerDeclaration>> {
    return discoverMcpServersFromConfigs("claude", configs, "jsonc");
  },
};
