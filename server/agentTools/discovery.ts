import { execFile } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, resolve } from "node:path";
import { AGENT_TOOL_IDS } from "../../core/types.ts";
import type {
  AgentToolDetails,
  AgentToolId,
  AgentToolSummary,
  ConfigurationReference,
  ToolCapabilityState,
  ToolInstallation,
} from "../../core/types.ts";
import { PROBE_TIMEOUT_MS } from "./bounds.ts";
import { TOOL_ADAPTERS } from "./adapters/index.ts";

interface ToolMatrixSpec {
  id: AgentToolId;
  name: string;
  cli: string;
  candidateBinaryRelPaths: string[];
  appBundleRelPath: string | null;
  candidateRoots: string[];
  configFiles: string[];
  capabilities: {
    skills: ToolCapabilityState;
    subagents: ToolCapabilityState;
    instructions: ToolCapabilityState;
    mcp: ToolCapabilityState;
    config: ToolCapabilityState;
    sessions: ToolCapabilityState;
  };
  subagentsReason?: string;
  sessionsReason?: string;
}

const TOOL_SPECS: Record<AgentToolId, ToolMatrixSpec> = {
  codex: {
    id: "codex",
    name: "Codex",
    cli: "codex",
    candidateBinaryRelPaths: [
      "/usr/local/bin/codex",
      "/opt/homebrew/bin/codex",
      "~/.codex/bin/codex",
      "~/.cargo/bin/codex",
    ],
    appBundleRelPath: "/Applications/Codex.app",
    candidateRoots: ["~/.codex"],
    configFiles: ["~/.codex/config.toml"],
    capabilities: {
      skills: "ready",
      subagents: "ready",
      instructions: "ready",
      mcp: "ready",
      config: "ready",
      sessions: "ready",
    },
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    cli: "opencode",
    candidateBinaryRelPaths: [
      "/usr/local/bin/opencode",
      "/opt/homebrew/bin/opencode",
      "~/.local/bin/opencode",
    ],
    appBundleRelPath: "/Applications/OpenCode.app",
    candidateRoots: ["~/.config/opencode", "~/.opencode"],
    configFiles: [
      "~/.config/opencode/opencode.json",
      "~/.opencode/opencode.json",
    ],
    capabilities: {
      skills: "ready",
      subagents: "ready",
      instructions: "ready",
      mcp: "ready",
      config: "ready",
      sessions: "ready",
    },
  },
  claude: {
    id: "claude",
    name: "Claude Code",
    cli: "claude",
    candidateBinaryRelPaths: [
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      "~/.npm-global/bin/claude",
    ],
    appBundleRelPath: "/Applications/Claude.app",
    candidateRoots: ["~/.claude", "~/Library/Application Support/Claude"],
    configFiles: [
      "~/.claude.json",
      "~/Library/Application Support/Claude/claude_desktop_config.json",
    ],
    capabilities: {
      skills: "ready",
      subagents: "unsupported",
      instructions: "ready",
      mcp: "ready",
      config: "ready",
      sessions: "ready",
    },
    subagentsReason:
      "Claude Code does not define standalone global sub-agent definition files in V1.",
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    cli: "agy",
    candidateBinaryRelPaths: [
      "/usr/local/bin/agy",
      "/opt/homebrew/bin/agy",
      "~/.gemini/antigravity/bin/agy",
      "~/.antigravity/bin/agy",
    ],
    appBundleRelPath: "/Applications/Antigravity.app",
    candidateRoots: ["~/.gemini/antigravity"],
    configFiles: [
      "~/.gemini/antigravity/config.json",
      "~/.gemini/antigravity/settings.json",
    ],
    capabilities: {
      skills: "ready",
      subagents: "unsupported",
      instructions: "ready",
      mcp: "ready",
      config: "ready",
      sessions: "unsupported",
    },
    subagentsReason:
      "Antigravity sub-agent definitions are managed via internal workspaces and protocol buffers; standalone file format is outside V1 scope.",
    sessionsReason:
      "Antigravity sessions unsupported in V1 because native session decoders (SQLite binary blobs / protocol buffers) are outside V1 scope.",
  },
  gemini: {
    id: "gemini",
    name: "Gemini CLI",
    cli: "gemini",
    candidateBinaryRelPaths: [
      "/usr/local/bin/gemini",
      "/opt/homebrew/bin/gemini",
      "~/.gemini/bin/gemini",
    ],
    appBundleRelPath: null,
    candidateRoots: ["~/.gemini"],
    configFiles: ["~/.gemini/config.json", "~/.gemini/settings.json"],
    capabilities: {
      skills: "ready",
      subagents: "unsupported",
      instructions: "ready",
      mcp: "ready",
      config: "ready",
      sessions: "unsupported",
    },
    subagentsReason:
      "Gemini CLI does not provide standalone global sub-agent definition files in V1.",
    sessionsReason:
      "Gemini CLI sessions unsupported in V1 because native session decoders are outside V1 scope.",
  },
};

function expandHome(filePath: string, home: string): string {
  if (filePath === "~") return home;
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return resolve(home, filePath.slice(2));
  }
  return filePath;
}

function findInPath(binaryName: string): string | null {
  const envPath = process.env.PATH ?? "";
  const parts = envPath.split(delimiter);
  for (const dir of parts) {
    if (!dir) continue;
    const full = resolve(dir, binaryName);
    try {
      if (existsSync(full)) {
        const st = statSync(full);
        if (st.isFile()) {
          return full;
        }
      }
    } catch {
      // Continue searching next PATH entry
    }
  }
  return null;
}

function probeVersion(executablePath: string): Promise<string | null> {
  return new Promise((resolvePromise) => {
    try {
      const child = execFile(
        executablePath,
        ["--version"],
        {
          timeout: PROBE_TIMEOUT_MS,
          maxBuffer: 64 * 1024,
          shell: false,
        },
        (error, stdout, stderr) => {
          if (error) {
            resolvePromise(null);
            return;
          }
          const text = (stdout || stderr || "").trim();
          if (!text) {
            resolvePromise(null);
            return;
          }
          const firstLine = text.split(/\r?\n/)[0].trim();
          resolvePromise(firstLine || null);
        },
      );
      child.on?.("error", () => resolvePromise(null));
    } catch {
      resolvePromise(null);
    }
  });
}

export async function discoverTools(customHome?: string): Promise<Map<AgentToolId, AgentToolDetails>> {
  const home = customHome ?? homedir();
  const results = new Map<AgentToolId, AgentToolDetails>();

  for (const toolId of AGENT_TOOL_IDS) {
    const spec = TOOL_SPECS[toolId];
    const candidatePaths = spec.candidateBinaryRelPaths.map((p) => expandHome(p, home));

    let executablePath: string | null = null;
    for (const candidate of candidatePaths) {
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          executablePath = candidate;
          break;
        }
      } catch {
        // Continue checking candidates
      }
    }

    if (!executablePath) {
      const fromPath = findInPath(spec.cli);
      if (fromPath) {
        executablePath = fromPath;
        if (!candidatePaths.includes(fromPath)) {
          candidatePaths.push(fromPath);
        }
      }
    }

    let appPath: string | null = null;
    if (spec.appBundleRelPath) {
      const fullAppPath = expandHome(spec.appBundleRelPath, home);
      try {
        if (existsSync(fullAppPath)) {
          appPath = fullAppPath;
        }
      } catch {
        // App bundle check failed
      }
    }

    let version: string | null = null;
    if (executablePath) {
      version = await probeVersion(executablePath);
    }

    const installation: ToolInstallation = {
      installed: executablePath !== null || appPath !== null,
      executablePath,
      appPath,
      version,
      candidatePaths,
      probedAt: new Date().toISOString(),
    };

    const resolvedCandidateRoots = spec.candidateRoots.map((r) => expandHome(r, home));
    const existingRoots = resolvedCandidateRoots.filter((r) => {
      try {
        return existsSync(r) && statSync(r).isDirectory();
      } catch {
        return false;
      }
    });
    const configuredRoots = existingRoots.length > 0 ? existingRoots : [resolvedCandidateRoots[0]];

    const adapter = TOOL_ADAPTERS[toolId];
    const [skills, subagents, instructions, configurations] = await Promise.all([
      adapter.discoverSkills(configuredRoots, home),
      adapter.discoverSubagents(configuredRoots, home),
      adapter.discoverInstructions(configuredRoots, home),
      adapter.discoverConfigurations(configuredRoots, home),
    ]);
    const mcpServers = await adapter.discoverMcpServers(configuredRoots, configurations);

    let warningCount = 0;
    if (skills.state === "error") warningCount++;
    if (subagents.state === "error") warningCount++;
    if (instructions.state === "error") warningCount++;
    if (mcpServers.state === "error") warningCount++;

    const summary: AgentToolSummary = {
      id: spec.id,
      name: spec.name,
      installation,
      capabilities: spec.capabilities,
      warningCount,
    };

    const details: AgentToolDetails = {
      summary,
      configuredRoots,
      lastRefreshedAt: new Date().toISOString(),
      skills,
      subagents: {
        ...subagents,
        ...(spec.subagentsReason && !subagents.reason ? { reason: spec.subagentsReason } : {}),
      },
      instructions,
      mcpServers,
      configurations,
      recentSessions: {
        state: spec.capabilities.sessions,
        items: [],
        ...(spec.sessionsReason ? { reason: spec.sessionsReason } : {}),
      },
    };

    results.set(toolId, details);
  }

  return results;
}
