import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ConfigurationReference,
  GlobalResource,
  McpServerDeclaration,
  ToolCapabilityResult,
} from "../../../core/types.ts";
import { MAX_RESOURCE_ITEMS } from "../bounds.ts";
import type { AgentToolAdapter } from "./types.ts";
import {
  discoverMcpServersFromConfigs,
  expandHome,
  isInsideRoots,
  scanConfigurationsFromCandidates,
  scanInstructionsFromCandidates,
  scanSkillsFromDirectories,
} from "./common.ts";
import { parseFrontmatter } from "./frontmatter.ts";

export const opencodeAdapter: AgentToolAdapter = {
  toolId: "opencode",

  async discoverSkills(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const skillDirs: string[] = [];
    for (const r of roots) {
      skillDirs.push(resolve(r, "skills"));
    }
    const defaultDir = expandHome("~/.config/opencode/skills", home);
    if (!skillDirs.includes(defaultDir)) {
      skillDirs.push(defaultDir);
    }
    return scanSkillsFromDirectories("opencode", skillDirs, roots);
  },

  async discoverSubagents(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const agentDirs: string[] = [];
    for (const r of roots) {
      agentDirs.push(resolve(r, "agents"));
    }
    const defaultDir = expandHome("~/.config/opencode/agents", home);
    if (!agentDirs.includes(defaultDir)) {
      agentDirs.push(defaultDir);
    }

    const items: GlobalResource[] = [];
    const seenCanonicalIds = new Set<string>();

    const canonicalRoots: string[] = [];
    for (const r of roots) {
      try {
        if (existsSync(r)) {
          canonicalRoots.push(await realpath(r));
        } else {
          canonicalRoots.push(r);
        }
      } catch {
        canonicalRoots.push(r);
      }
    }

    for (const dir of agentDirs) {
      if (items.length >= MAX_RESOURCE_ITEMS) break;

      try {
        const st = await stat(dir);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (items.length >= MAX_RESOURCE_ITEMS) break;
        if (entry.name.startsWith(".")) continue;

        const fullPath = resolve(dir, entry.name);
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            const st = await stat(fullPath);
            isFile = st.isFile();
          } catch {
            continue;
          }
        }
        if (!isFile || !entry.name.endsWith(".md")) continue;
        let canonicalId: string;
        try {
          canonicalId = await realpath(fullPath);
        } catch {
          canonicalId = fullPath;
        }

        if (seenCanonicalIds.has(canonicalId)) continue;
        seenCanonicalIds.add(canonicalId);

        let content = "";
        try {
          content = await readFile(fullPath, "utf8");
        } catch {
          // Ignore read failure
        }

        const meta = parseFrontmatter(content);
        const fallbackName = entry.name.slice(0, -3);
        const origin = isInsideRoots(canonicalId, canonicalRoots) ? "user" : "shared";

        items.push({
          id: `subagent-opencode-${items.length + 1}`,
          toolId: "opencode",
          kind: "subagent",
          name: meta.name || fallbackName,
          description: meta.description,
          path: fullPath,
          canonicalId,
          origin,
          activation: "enabled",
          modelRestriction: meta.model,
          toolRestrictions: meta.permission,
        });
      }
    }

    return {
      state: "ready",
      items,
      ...(items.length >= MAX_RESOURCE_ITEMS ? { truncated: true } : {}),
    };
  },

  async discoverInstructions(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const candidates: string[] = [];
    for (const r of roots) {
      candidates.push(resolve(r, "INSTRUCTIONS.md"));
      candidates.push(resolve(r, "AGENTS.md"));
    }
    const defaultInst = expandHome("~/.config/opencode/INSTRUCTIONS.md", home);
    const defaultAgents = expandHome("~/.config/opencode/AGENTS.md", home);
    if (!candidates.includes(defaultInst)) candidates.push(defaultInst);
    if (!candidates.includes(defaultAgents)) candidates.push(defaultAgents);

    return scanInstructionsFromCandidates("opencode", candidates, roots);
  },

  async discoverConfigurations(roots: string[], home?: string): Promise<ConfigurationReference[]> {
    const candidates: string[] = [];
    for (const r of roots) {
      candidates.push(resolve(r, "opencode.json"));
    }
    const defaultCfg1 = expandHome("~/.config/opencode/opencode.json", home);
    const defaultCfg2 = expandHome("~/.opencode/opencode.json", home);
    if (!candidates.includes(defaultCfg1)) candidates.push(defaultCfg1);
    if (!candidates.includes(defaultCfg2)) candidates.push(defaultCfg2);

    return scanConfigurationsFromCandidates("opencode", candidates);
  },

  async discoverMcpServers(_roots: string[], configs: ConfigurationReference[]): Promise<ToolCapabilityResult<McpServerDeclaration>> {
    return discoverMcpServersFromConfigs("opencode", configs, "jsonc");
  },
};
