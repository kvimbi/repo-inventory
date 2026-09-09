import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ConfigurationReference,
  GlobalResource,
  McpServerDeclaration,
  ToolCapabilityResult,
} from "../../../core/types.ts";
import type { AgentToolAdapter } from "./types.ts";
import { MAX_RESOURCE_ITEMS } from "../bounds.ts";
import {
  discoverMcpServersFromConfigs,
  expandHome,
  isInsideRoots,
  scanConfigurationsFromCandidates,
  scanInstructionsFromCandidates,
  scanSkillsFromDirectories,
} from "./common.ts";
import { safeParseToml } from "../toml.ts";

function pathDiagnostic(path: string, operation: string): string {
  return `${path}: unable to ${operation}`;
}

export const codexAdapter: AgentToolAdapter = {
  toolId: "codex",

  async discoverSkills(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const skillDirs: string[] = [];
    for (const r of roots) {
      skillDirs.push(resolve(r, "skills"));
    }
    const defaultDir = expandHome("~/.codex/skills", home);
    if (!skillDirs.includes(defaultDir)) {
      skillDirs.push(defaultDir);
    }
    return scanSkillsFromDirectories("codex", skillDirs, roots);
  },

  async discoverSubagents(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const agentDirs = roots.map((root) => resolve(root, "agents"));
    const defaultDir = expandHome("~/.codex/agents", home);
    if (!agentDirs.includes(defaultDir)) agentDirs.push(defaultDir);
    const canonicalRoots: string[] = [];
    for (const root of roots) {
      try {
        canonicalRoots.push(existsSync(root) ? await realpath(root) : root);
      } catch {
        canonicalRoots.push(root);
      }
    }
    const items: GlobalResource[] = [];
    const diagnostics: string[] = [];
    const seen = new Set<string>();
    let truncated = false;
    for (const dir of agentDirs) {
      if (items.length >= MAX_RESOURCE_ITEMS) { truncated = true; break; }
      let entries;
      try {
        const dirStat = await stat(dir);
        if (!dirStat.isDirectory()) continue;
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        diagnostics.push(pathDiagnostic(dir, "read agent definitions"));
        continue;
      }
      for (const entry of entries) {
        if (items.length >= MAX_RESOURCE_ITEMS) { truncated = true; break; }
        if (entry.name.startsWith(".") || !entry.name.endsWith(".toml")) continue;
        const path = resolve(dir, entry.name);
        try {
          const entryStat = entry.isSymbolicLink() ? await stat(path) : entry;
          if (!entryStat.isFile()) continue;
        } catch (error) {
          diagnostics.push(pathDiagnostic(path, "inspect agent definition"));
          continue;
        }
        let canonicalId: string;
        try { canonicalId = await realpath(path); } catch {
          diagnostics.push(pathDiagnostic(path, "resolve agent definition"));
          continue;
        }
        if (seen.has(canonicalId)) continue;
        seen.add(canonicalId);
        let content: string;
        try { content = await readFile(path, "utf8"); } catch {
          diagnostics.push(pathDiagnostic(path, "read agent definition"));
          continue;
        }
        const parsed = safeParseToml(content);
        if (!parsed.ok) { diagnostics.push(pathDiagnostic(path, "parse TOML agent definition")); continue; }
        const data = parsed.data;
        const required = ["name", "description", "developer_instructions"] as const;
        const invalid = required.find((key) => typeof data[key] !== "string" || !(data[key] as string).trim());
        if (invalid) { diagnostics.push(`${path}: required field '${invalid}' must be a non-empty string`); continue; }
        items.push({
          id: `subagent-codex-${items.length + 1}`,
          toolId: "codex",
          kind: "subagent",
          name: data.name as string,
          description: data.description as string,
          path,
          canonicalId,
          origin: isInsideRoots(canonicalId, canonicalRoots) ? "user" : "shared",
          activation: "enabled",
          ...(typeof data.model === "string" ? { modelRestriction: data.model } : {}),
          ...(typeof data.model_reasoning_effort === "string" ? { reasoningEffort: data.model_reasoning_effort } : {}),
          ...(typeof data.sandbox_mode === "string" ? { sandboxMode: data.sandbox_mode } : {}),
        });
      }
    }
    return {
      state: diagnostics.length > 0 ? "error" : "ready",
      items,
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
      ...(truncated ? { truncated: true } : {}),
    };
  },

  async discoverInstructions(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>> {
    const candidates: string[] = [];
    for (const r of roots) {
      candidates.push(resolve(r, "instructions.md"));
      candidates.push(resolve(r, "AGENTS.md"));
    }
    const defaultInst = expandHome("~/.codex/instructions.md", home);
    const defaultAgents = expandHome("~/.codex/AGENTS.md", home);
    if (!candidates.includes(defaultInst)) candidates.push(defaultInst);
    if (!candidates.includes(defaultAgents)) candidates.push(defaultAgents);

    return scanInstructionsFromCandidates("codex", candidates, roots);
  },

  async discoverConfigurations(roots: string[], home?: string): Promise<ConfigurationReference[]> {
    const candidates: string[] = [];
    for (const r of roots) {
      candidates.push(resolve(r, "config.toml"));
    }
    const defaultCfg = expandHome("~/.codex/config.toml", home);
    if (!candidates.includes(defaultCfg)) candidates.push(defaultCfg);

    return scanConfigurationsFromCandidates("codex", candidates);
  },

  async discoverMcpServers(_roots: string[], configs: ConfigurationReference[]): Promise<ToolCapabilityResult<McpServerDeclaration>> {
    return discoverMcpServersFromConfigs("codex", configs, "toml");
  },
};
