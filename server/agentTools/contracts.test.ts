import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { AGENT_TOOL_IDS } from "../../core/types.ts";
import type {
  AgentResourcePreview,
  AgentToolDetails,
  AgentToolId,
  AgentToolsListResult,
  AgentToolSummary,
  ConfigurationReference,
  GlobalResource,
  McpServerDeclaration,
  OpenConfigurationRequest,
  OpenConfigurationResult,
  ReadResourceRequest,
  RecentSessionSummary,
  ToolInstallation,
} from "../../core/types.ts";
import {
  MAX_MCP_SERVERS,
  MAX_PREVIEW_BYTES,
  MAX_RESOURCE_ITEMS,
  MAX_SESSIONS_PER_TOOL,
  PROBE_TIMEOUT_MS,
} from "./bounds.ts";
import { parseJsonc, safeParseJsonc } from "./jsonc.ts";
import { parseToml, safeParseToml } from "./toml.ts";

const FIXTURES_DIR = resolve(import.meta.dirname, "../../test/fixtures/agentTools");

test("AGENT_TOOL_IDS and domain types conform to frozen contract", () => {
  assert.deepEqual(AGENT_TOOL_IDS, [
    "codex",
    "opencode",
    "claude",
    "antigravity",
    "gemini",
  ]);

  const testToolId: AgentToolId = "codex";
  assert.equal(testToolId, "codex");

  const sampleInstallation: ToolInstallation = {
    installed: true,
    executablePath: "/usr/local/bin/codex",
    appPath: null,
    version: "1.0.0",
    candidatePaths: ["/usr/local/bin/codex"],
    probedAt: "2026-09-08T11:00:00.000Z",
  };
  assert.equal(sampleInstallation.installed, true);

  const sampleResource: GlobalResource = {
    id: "codex-skill-1",
    toolId: "codex",
    kind: "skill",
    name: "deploy-helper",
    description: "Assists with deployment",
    path: "/home/user/.codex/skills/deploy",
    canonicalId: "can-deploy-1",
    origin: "user",
    activation: "enabled",
    modelRestriction: "gpt-4o",
    toolRestrictions: ["bash"],
  };
  assert.equal(sampleResource.kind, "skill");

  const sampleConfigRef: ConfigurationReference = {
    id: "cfg-codex",
    toolId: "codex",
    label: "config.toml",
    path: "/home/user/.codex/config.toml",
    canonicalPath: "/home/user/.codex/config.toml",
    exists: true,
    sizeBytes: 1024,
    lastModifiedAt: "2026-09-08T10:00:00.000Z",
  };
  assert.equal(sampleConfigRef.exists, true);

  const sampleMcp: McpServerDeclaration = {
    id: "mcp-codex-filesystem",
    toolId: "codex",
    name: "filesystem",
    transport: "stdio",
    state: "enabled",
    configRefId: "cfg-codex",
    sourcePath: "/home/user/.codex/config.toml",
    duplicate: false,
    conflict: false,
  };
  assert.equal(sampleMcp.transport, "stdio");

  const sampleSession: RecentSessionSummary = {
    id: "sess-1",
    toolId: "codex",
    title: "Refactor database",
    clientMode: "cli",
    lastActivityAt: "2026-09-08T10:30:00.000Z",
    projectAssociation: {
      kind: "known_project",
      projectId: "proj-1",
      path: "/code/project",
      name: "project",
    },
    transcriptAvailable: true,
  };
  assert.equal(sampleSession.transcriptAvailable, true);

  const sampleSummary: AgentToolSummary = {
    id: "codex",
    name: "Codex",
    installation: sampleInstallation,
    capabilities: {
      skills: "ready",
      subagents: "ready",
      instructions: "ready",
      mcp: "ready",
      config: "ready",
      sessions: "ready",
    },
    warningCount: 0,
  };
  assert.equal(sampleSummary.capabilities.skills, "ready");

  const sampleDetails: AgentToolDetails = {
    summary: sampleSummary,
    configuredRoots: ["/home/user/.codex"],
    lastRefreshedAt: "2026-09-08T11:00:00.000Z",
    skills: { state: "ready", items: [sampleResource] },
    subagents: { state: "unsupported", items: [], reason: "Codex subagents unverified" },
    instructions: { state: "missing", items: [] },
    mcpServers: { state: "ready", items: [sampleMcp] },
    configurations: [sampleConfigRef],
    recentSessions: { state: "ready", items: [sampleSession] },
  };
  assert.equal(sampleDetails.skills.items.length, 1);

  const samplePreview: AgentResourcePreview = {
    id: "prev-1",
    name: "README.md",
    content: "# Skill Docs",
    isMarkdown: true,
    truncated: false,
    totalBytes: 12,
  };
  assert.equal(samplePreview.isMarkdown, true);

  const sampleOpenReq: OpenConfigurationRequest = {
    ref: "cfg-codex",
    action: "editor",
  };
  assert.equal(sampleOpenReq.action, "editor");

  const sampleOpenRes: OpenConfigurationResult = {
    ok: true,
    message: "Opened successfully",
  };
  assert.equal(sampleOpenRes.ok, true);

  const sampleReadReq: ReadResourceRequest = {
    ref: "codex-skill-1",
  };
  assert.equal(sampleReadReq.ref, "codex-skill-1");

  const sampleListRes: AgentToolsListResult = {
    tools: [sampleSummary],
  };
  assert.equal(sampleListRes.tools.length, 1);
});

test("bounds constants match specification limits", () => {
  assert.equal(MAX_PREVIEW_BYTES, 256_000);
  assert.equal(MAX_RESOURCE_ITEMS, 100);
  assert.equal(MAX_MCP_SERVERS, 100);
  assert.equal(MAX_SESSIONS_PER_TOOL, 50);
  assert.equal(PROBE_TIMEOUT_MS, 2500);
});

test("TOML parser parses basic and complex structures correctly", () => {
  const sampleToml = `
# Global configuration
title = "TOML Test"
enable_feature = true
count = 42
pi = 3.1415
negative = -10
hex_num = 0x1F
large_num = 1_000_000

# String varieties
str_basic = "hello \\"world\\"\\nwith newline and \\u0041"
str_literal = 'literal \\n no escape'
str_multi = """
first line
second line\\
continued
"""

# Arrays with mixed spacing and trailing comma
tags = [
  "alpha",
  "beta",
  "gamma",
]
nested_arr = [[1, 2], [3, 4]]

# Inline table
inline_info = { host = "localhost", port = 8080, active = true }

# Dotted keys and section tables
[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem"]

# Quoted keys in tables
[plugins."openai@skills"]
enabled = true
source = "local"

[projects."/home/user/workspace"]
trust = true
`;

  const parsed = parseToml(sampleToml);
  assert.equal(parsed.title, "TOML Test");
  assert.equal(parsed.enable_feature, true);
  assert.equal(parsed.count, 42);
  assert.equal(parsed.pi, 3.1415);
  assert.equal(parsed.negative, -10);
  assert.equal(parsed.hex_num, 31);
  assert.equal(parsed.large_num, 1_000_000);

  assert.equal(parsed.str_basic, 'hello "world"\nwith newline and A');
  assert.equal(parsed.str_literal, "literal \\n no escape");
  assert.equal(parsed.str_multi, "first line\nsecond linecontinued\n");

  assert.deepEqual(parsed.tags, ["alpha", "beta", "gamma"]);
  assert.deepEqual(parsed.nested_arr, [[1, 2], [3, 4]]);
  assert.deepEqual(parsed.inline_info, { host: "localhost", port: 8080, active: true });

  const mcpServers = parsed.mcp_servers as Record<string, unknown>;
  assert.ok(mcpServers);
  const fsServer = mcpServers.filesystem as Record<string, unknown>;
  assert.equal(fsServer.command, "npx");
  assert.deepEqual(fsServer.args, ["-y", "@modelcontextprotocol/server-filesystem"]);

  const plugins = parsed.plugins as Record<string, unknown>;
  const skillPlugin = plugins["openai@skills"] as Record<string, unknown>;
  assert.equal(skillPlugin.enabled, true);
  assert.equal(skillPlugin.source, "local");

  const projects = parsed.projects as Record<string, unknown>;
  const workspace = projects["/home/user/workspace"] as Record<string, unknown>;
  assert.equal(workspace.trust, true);
});

test("TOML parser handles array of tables", () => {
  const toml = `
[[servers]]
name = "alpha"
port = 8001

[[servers]]
name = "beta"
port = 8002
`;
  const parsed = parseToml(toml);
  assert.deepEqual(parsed.servers, [
    { name: "alpha", port: 8001 },
    { name: "beta", port: 8002 },
  ]);
});

test("TOML parser throws descriptive error on malformed syntax", () => {
  const badToml = `
[invalid table
key = "value"
`;
  assert.throws(
    () => parseToml(badToml),
    /TOML parse error at line 2/
  );

  const safeResult = safeParseToml(badToml);
  assert.equal(safeResult.ok, false);
  if (!safeResult.ok) {
    assert.match(safeResult.error, /TOML parse error/);
  }
});

test("JSONC parser handles comments and trailing commas", () => {
  const jsoncContent = `
{
  // Single line comment
  "name": "jsonc-test",
  /* Multi
     line
     comment */
  "enabled": true,
  "list": [
    1,
    2,
    3,
  ],
}
`;

  const parsed = parseJsonc(jsoncContent) as { name: string; enabled: boolean; list: number[] };
  assert.equal(parsed.name, "jsonc-test");
  assert.equal(parsed.enabled, true);
  assert.deepEqual(parsed.list, [1, 2, 3]);

  const safeSuccess = safeParseJsonc(jsoncContent);
  assert.equal(safeSuccess.ok, true);

  const badJsonc = "{ missing_value: , }";
  assert.throws(() => parseJsonc(badJsonc), /JSONC parse error/);
  const safeFail = safeParseJsonc(badJsonc);
  assert.equal(safeFail.ok, false);
});

test("synthetic Codex fixture validates with parseToml", async () => {
  const content = await readFile(resolve(FIXTURES_DIR, "codex/config.toml"), "utf8");
  const parsed = parseToml(content);

  const mcpServers = parsed.mcp_servers as Record<string, Record<string, unknown>>;
  assert.ok(mcpServers.filesystem);
  assert.equal(mcpServers.filesystem.command, "npx");
  assert.deepEqual(mcpServers.filesystem.args, [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "/Users/synthetic/code",
  ]);

  assert.ok(mcpServers.memory);
  assert.equal(mcpServers.memory.command, "npx");

  const plugins = parsed.plugins as Record<string, Record<string, unknown>>;
  assert.equal(plugins["openai@skills"].enabled, true);
  assert.equal(plugins["openai@skills"].source, "bundled");

  const projects = parsed.projects as Record<string, Record<string, unknown>>;
  assert.equal(projects["/Users/synthetic/code/repo-inventory"].trust, true);
  assert.equal(projects["/Users/synthetic/code/repo-inventory"].model, "gpt-4o");
});

test("synthetic OpenCode fixture validates with parseJsonc", async () => {
  const content = await readFile(resolve(FIXTURES_DIR, "opencode/opencode.json"), "utf8");
  const parsed = parseJsonc(content) as {
    mcp: { servers: Record<string, { command: string; args: string[] }> };
    lsp: Record<string, { command: string; args: string[] }>;
  };

  assert.ok(parsed.mcp.servers.github);
  assert.equal(parsed.mcp.servers.github.command, "npx");
  assert.deepEqual(parsed.mcp.servers.github.args, [
    "-y",
    "@modelcontextprotocol/server-github",
  ]);

  assert.ok(parsed.mcp.servers.fetch);
  assert.equal(parsed.mcp.servers.fetch.command, "uvx");

  assert.ok(parsed.lsp.typescript);
  assert.equal(parsed.lsp.typescript.command, "typescript-language-server");
});

test("synthetic Claude Desktop fixture validates with parseJsonc", async () => {
  const content = await readFile(
    resolve(FIXTURES_DIR, "claude/claude_desktop_config.json"),
    "utf8"
  );
  const parsed = parseJsonc(content) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };

  assert.ok(parsed.mcpServers.sqlite);
  assert.equal(parsed.mcpServers.sqlite.command, "uvx");
  assert.deepEqual(parsed.mcpServers.sqlite.args, [
    "mcp-server-sqlite",
    "--db-path",
    "/tmp/synthetic.db",
  ]);

  assert.ok(parsed.mcpServers["brave-search"]);
  assert.equal(parsed.mcpServers["brave-search"].command, "npx");
});
