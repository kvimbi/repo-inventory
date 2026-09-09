import type { Probe } from "../core/types.ts";
import { stat } from "node:fs/promises";
import { join } from "node:path";

const AGENT_TOOLS: Array<[string | string[], string]> = [
  [".claude/", "claude"],
  ["CLAUDE.md", "claude-md"],
  [".opencode/", "opencode"],
  ["AGENTS.md", "agents-md"],
  [[".cursor/", ".cursorrules"], "cursor"],
  [".github/copilot-instructions.md", "copilot"],
  [".mcp.json", "mcp-config"],
  [".windsurfrules", "windsurf"],
  [".agents/", "agents"],
];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export const probe: Probe = {
  name: "agent-tooling",
  order: 50,
  async detect({ path, facts, quick }) {
    if (quick && facts.agentTooling !== undefined) {
      return {};
    }
    const found: string[] = [];
    for (const [paths, name] of AGENT_TOOLS) {
      if (Array.isArray(paths)) {
        for (const p of paths) {
          if (await exists(join(path, p))) {
            found.push(name);
            break;
          }
        }
      } else {
        if (await exists(join(path, paths))) {
          found.push(name);
        }
      }
    }
    if (found.length === 0) return;
    return { agentTooling: found.sort() };
  },
};
