import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { ConfigurationReference, McpServerDeclaration } from "../../core/types.ts";
import { antigravityAdapter } from "./adapters/antigravity.ts";
import { claudeAdapter } from "./adapters/claude.ts";
import { codexAdapter } from "./adapters/codex.ts";
import {
  flagDuplicatesAndConflicts,
  parseMcpFromJsoncConfig,
  parseMcpFromTomlConfig,
} from "./adapters/common.ts";
import { geminiAdapter } from "./adapters/gemini.ts";
import { opencodeAdapter } from "./adapters/opencode.ts";
import { MAX_MCP_SERVERS } from "./bounds.ts";

const FIXTURES_DIR = resolve(import.meta.dirname, "../../test/fixtures/agentTools");

test("MCP extraction for Codex, OpenCode, and Claude against synthetic fixtures", async () => {
  // 1. Codex synthetic fixture
  const codexPath = resolve(FIXTURES_DIR, "codex/config.toml");
  const codexRef: ConfigurationReference = {
    id: "cfg-codex-1",
    toolId: "codex",
    label: "config.toml",
    path: codexPath,
    canonicalPath: codexPath,
    exists: true,
  };
  const codexResult = await codexAdapter.discoverMcpServers([], [codexRef]);
  assert.equal(codexResult.state, "ready");
  assert.equal(codexResult.items.length, 2);

  const codexFs = codexResult.items.find((s) => s.name === "filesystem");
  assert.ok(codexFs);
  assert.equal(codexFs.toolId, "codex");
  assert.equal(codexFs.transport, "stdio");
  assert.equal(codexFs.state, "enabled");
  assert.equal(codexFs.configRefId, "cfg-codex-1");
  assert.equal(codexFs.sourcePath, codexPath);

  const codexMem = codexResult.items.find((s) => s.name === "memory");
  assert.ok(codexMem);
  assert.equal(codexMem.toolId, "codex");
  assert.equal(codexMem.transport, "stdio");
  assert.equal(codexMem.state, "enabled");

  // 2. OpenCode synthetic fixture
  const opencodePath = resolve(FIXTURES_DIR, "opencode/opencode.json");
  const opencodeRef: ConfigurationReference = {
    id: "cfg-opencode-1",
    toolId: "opencode",
    label: "opencode.json",
    path: opencodePath,
    canonicalPath: opencodePath,
    exists: true,
  };
  const opencodeResult = await opencodeAdapter.discoverMcpServers([], [opencodeRef]);
  assert.equal(opencodeResult.state, "ready");
  assert.equal(opencodeResult.items.length, 2);

  const openGithub = opencodeResult.items.find((s) => s.name === "github");
  assert.ok(openGithub);
  assert.equal(openGithub.toolId, "opencode");
  assert.equal(openGithub.transport, "stdio");
  assert.equal(openGithub.state, "enabled");
  assert.equal(openGithub.configRefId, "cfg-opencode-1");

  const openFetch = opencodeResult.items.find((s) => s.name === "fetch");
  assert.ok(openFetch);
  assert.equal(openFetch.toolId, "opencode");
  assert.equal(openFetch.transport, "stdio");
  assert.equal(openFetch.state, "enabled");

  // 3. Claude Desktop synthetic fixture
  const claudePath = resolve(FIXTURES_DIR, "claude/claude_desktop_config.json");
  const claudeRef: ConfigurationReference = {
    id: "cfg-claude-1",
    toolId: "claude",
    label: "claude_desktop_config.json",
    path: claudePath,
    canonicalPath: claudePath,
    exists: true,
  };
  const claudeResult = await claudeAdapter.discoverMcpServers([], [claudeRef]);
  assert.equal(claudeResult.state, "ready");
  assert.equal(claudeResult.items.length, 2);

  const claudeSqlite = claudeResult.items.find((s) => s.name === "sqlite");
  assert.ok(claudeSqlite);
  assert.equal(claudeSqlite.toolId, "claude");
  assert.equal(claudeSqlite.transport, "stdio");
  assert.equal(claudeSqlite.state, "enabled");

  const claudeBrave = claudeResult.items.find((s) => s.name === "brave-search");
  assert.ok(claudeBrave);
  assert.equal(claudeBrave.toolId, "claude");
  assert.equal(claudeBrave.transport, "stdio");
  assert.equal(claudeBrave.state, "enabled");
});

test("zero leaks: credentials, args, env, headers, and query strings are NEVER present in declarations", async () => {
  const codexPath = resolve(FIXTURES_DIR, "codex/config.toml");
  const opencodePath = resolve(FIXTURES_DIR, "opencode/opencode.json");
  const claudePath = resolve(FIXTURES_DIR, "claude/claude_desktop_config.json");

  const [codexRes, opencodeRes, claudeRes] = await Promise.all([
    codexAdapter.discoverMcpServers([], [
      { id: "cfg-codex", toolId: "codex", label: "config.toml", path: codexPath, canonicalPath: codexPath, exists: true },
    ]),
    opencodeAdapter.discoverMcpServers([], [
      { id: "cfg-opencode", toolId: "opencode", label: "opencode.json", path: opencodePath, canonicalPath: opencodePath, exists: true },
    ]),
    claudeAdapter.discoverMcpServers([], [
      { id: "cfg-claude", toolId: "claude", label: "claude_desktop_config.json", path: claudePath, canonicalPath: claudePath, exists: true },
    ]),
  ]);

  const allDecls = [...codexRes.items, ...opencodeRes.items, ...claudeRes.items];
  assert.equal(allDecls.length, 6);

  const forbiddenKeys = ["args", "env", "headers", "tokens", "token", "apiKey", "command", "url", "rawConfig"];
  const forbiddenValues = [
    "GITHUB_PERSONAL_ACCESS_TOKEN",
    "ghp_synthetic_token_test",
    "BRAVE_API_KEY",
    "synthetic_brave_key",
    "@modelcontextprotocol/server-filesystem",
    "@modelcontextprotocol/server-github",
    "@modelcontextprotocol/server-brave-search",
    "/tmp/synthetic.db",
    "--db-path",
    "/Users/synthetic/code",
  ];

  const allowedKeys = new Set([
    "id",
    "toolId",
    "name",
    "transport",
    "state",
    "configRefId",
    "sourcePath",
    "duplicate",
    "conflict",
  ]);

  for (const decl of allDecls) {
    const declObj = decl as unknown as Record<string, unknown>;

    for (const key of Object.keys(declObj)) {
      assert.ok(allowedKeys.has(key), `Declaration must not contain unexpected field: ${key}`);
    }

    for (const forbiddenKey of forbiddenKeys) {
      assert.equal(forbiddenKey in declObj, false, `Field ${forbiddenKey} must not exist on declaration`);
    }

    const serialized = JSON.stringify(decl);
    for (const forbiddenVal of forbiddenValues) {
      assert.equal(
        serialized.includes(forbiddenVal),
        false,
        `Declaration serialization must not leak secret or arg value '${forbiddenVal}'`,
      );
    }
  }
});

test("duplicate and conflict detection handles identical and differing declarations", () => {
  const baseRef: ConfigurationReference = {
    id: "cfg-1",
    toolId: "codex",
    label: "config.toml",
    path: "/path/config.toml",
    canonicalPath: "/path/config.toml",
    exists: true,
  };

  // Case 1: Unique item — neither duplicate nor conflict
  const single = flagDuplicatesAndConflicts([
    {
      id: "mcp-1",
      toolId: "codex",
      name: "unique-server",
      transport: "stdio",
      state: "enabled",
      configRefId: "cfg-1",
      sourcePath: "/path/1",
    },
  ]);
  assert.equal(single[0].duplicate, false);
  assert.equal(single[0].conflict, false);

  // Case 2: Matching duplicate (same transport and state across 2 configs)
  const matchingDuplicates = flagDuplicatesAndConflicts([
    {
      id: "mcp-1",
      toolId: "codex",
      name: "shared-server",
      transport: "stdio",
      state: "enabled",
      configRefId: "cfg-1",
      sourcePath: "/path/1",
    },
    {
      id: "mcp-2",
      toolId: "codex",
      name: "shared-server",
      transport: "stdio",
      state: "enabled",
      configRefId: "cfg-2",
      sourcePath: "/path/2",
    },
  ]);
  assert.equal(matchingDuplicates.length, 2);
  assert.equal(matchingDuplicates[0].duplicate, true);
  assert.equal(matchingDuplicates[0].conflict, false);
  assert.equal(matchingDuplicates[1].duplicate, true);
  assert.equal(matchingDuplicates[1].conflict, false);

  // Case 3: Conflicting transport (stdio vs sse)
  const transportConflict = flagDuplicatesAndConflicts([
    {
      id: "mcp-1",
      toolId: "claude",
      name: "remote-server",
      transport: "stdio",
      state: "enabled",
      configRefId: "cfg-1",
      sourcePath: "/path/1",
    },
    {
      id: "mcp-2",
      toolId: "claude",
      name: "remote-server",
      transport: "sse",
      state: "enabled",
      configRefId: "cfg-2",
      sourcePath: "/path/2",
    },
  ]);
  assert.equal(transportConflict.length, 2);
  assert.equal(transportConflict[0].duplicate, true);
  assert.equal(transportConflict[0].conflict, true);
  assert.equal(transportConflict[1].duplicate, true);
  assert.equal(transportConflict[1].conflict, true);

  // Case 4: Conflicting state (enabled vs disabled)
  const stateConflict = flagDuplicatesAndConflicts([
    {
      id: "mcp-1",
      toolId: "opencode",
      name: "toggle-server",
      transport: "stdio",
      state: "enabled",
      configRefId: "cfg-1",
      sourcePath: "/path/1",
    },
    {
      id: "mcp-2",
      toolId: "opencode",
      name: "toggle-server",
      transport: "stdio",
      state: "disabled",
      configRefId: "cfg-2",
      sourcePath: "/path/2",
    },
  ]);
  assert.equal(stateConflict.length, 2);
  assert.equal(stateConflict[0].duplicate, true);
  assert.equal(stateConflict[0].conflict, true);
  assert.equal(stateConflict[1].duplicate, true);
  assert.equal(stateConflict[1].conflict, true);
});

test("malformed config file error isolation does not throw and returns error state", async () => {
  const baseTmp = await mkdtemp(join(tmpdir(), "mcp-malformed-test-"));

  try {
    const badTomlPath = join(baseTmp, "bad-config.toml");
    await writeFile(badTomlPath, "[mcp_servers\ninvalid syntax :::", "utf8");

    const badTomlRef: ConfigurationReference = {
      id: "cfg-bad-toml",
      toolId: "codex",
      label: "bad-config.toml",
      path: badTomlPath,
      canonicalPath: badTomlPath,
      exists: true,
    };

    // Calling discoverMcpServers with malformed TOML does not throw
    const tomlResult = await codexAdapter.discoverMcpServers([], [badTomlRef]);
    assert.equal(tomlResult.state, "error");
    assert.equal(tomlResult.items.length, 0);
    assert.ok(tomlResult.reason?.includes("Failed to parse bad-config.toml"));

    // Calling parseMcpFromTomlConfig directly with malformed content safely returns empty array
    const directTomlDecls = parseMcpFromTomlConfig(badTomlRef, "[mcp_servers\ninvalid :::");
    assert.deepEqual(directTomlDecls, []);

    // Malformed JSONC file isolation
    const badJsoncPath = join(baseTmp, "bad-opencode.json");
    await writeFile(badJsoncPath, '{ mcpServers: { invalid JSON content', "utf8");

    const badJsoncRef: ConfigurationReference = {
      id: "cfg-bad-jsonc",
      toolId: "opencode",
      label: "bad-opencode.json",
      path: badJsoncPath,
      canonicalPath: badJsoncPath,
      exists: true,
    };

    const jsoncResult = await opencodeAdapter.discoverMcpServers([], [badJsoncRef]);
    assert.equal(jsoncResult.state, "error");
    assert.equal(jsoncResult.items.length, 0);
    assert.ok(jsoncResult.reason?.includes("Failed to parse bad-opencode.json"));

    // Calling parseMcpFromJsoncConfig directly with malformed content safely returns empty array
    const directJsoncDecls = parseMcpFromJsoncConfig(badJsoncRef, "{ bad json");
    assert.deepEqual(directJsoncDecls, []);

    // Multi-file isolation: malformed file does NOT abort discovery of valid file
    const goodTomlPath = join(baseTmp, "good-config.toml");
    await writeFile(goodTomlPath, '[mcp_servers.my_valid_server]\ncommand = "node"\n', "utf8");

    const goodTomlRef: ConfigurationReference = {
      id: "cfg-good-toml",
      toolId: "codex",
      label: "good-config.toml",
      path: goodTomlPath,
      canonicalPath: goodTomlPath,
      exists: true,
    };

    const multiResult = await codexAdapter.discoverMcpServers([], [badTomlRef, goodTomlRef]);
    assert.equal(multiResult.state, "ready");
    assert.equal(multiResult.items.length, 1);
    assert.equal(multiResult.items[0].name, "my_valid_server");
    assert.ok(multiResult.reason?.includes("Failed to parse bad-config.toml"));
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});

test("transport and state inference covers stdio, sse, http, disabled, and unknown", () => {
  const dummyRef: ConfigurationReference = {
    id: "cfg-test",
    toolId: "opencode",
    label: "opencode.json",
    path: "/test/opencode.json",
    canonicalPath: "/test/opencode.json",
    exists: true,
  };

  const jsonContent = JSON.stringify({
    mcpServers: {
      stdioServer: { command: "python", args: ["server.py"] },
      sseUrlServer: { url: "https://example.com/sse" },
      httpUrlServer: { url: "https://example.com/mcp" },
      explicitSse: { type: "sse", url: "https://example.com" },
      explicitHttp: { type: "http", url: "https://example.com" },
      disabledServer: { command: "npx", disabled: true },
      disabledViaEnabledFalse: { command: "npx", enabled: false },
      unknownTransport: { notes: "no command and no url" },
    },
  });

  const decls = parseMcpFromJsoncConfig(dummyRef, jsonContent);
  assert.equal(decls.length, 8);

  const map = new Map(decls.map((d) => [d.name, d]));
  assert.equal(map.get("stdioServer")?.transport, "stdio");
  assert.equal(map.get("stdioServer")?.state, "enabled");

  assert.equal(map.get("sseUrlServer")?.transport, "sse");
  assert.equal(map.get("httpUrlServer")?.transport, "http");
  assert.equal(map.get("explicitSse")?.transport, "sse");
  assert.equal(map.get("explicitHttp")?.transport, "http");
  assert.equal(map.get("disabledServer")?.state, "disabled");
  assert.equal(map.get("disabledViaEnabledFalse")?.state, "disabled");
  assert.equal(map.get("unknownTransport")?.transport, "unknown");
});

test("capping at MAX_MCP_SERVERS sets truncated to true", async () => {
  const baseTmp = await mkdtemp(join(tmpdir(), "mcp-cap-test-"));

  try {
    const serversToml: string[] = [];
    for (let i = 1; i <= 105; i++) {
      serversToml.push(`[mcp_servers.server_${i}]\ncommand = "cmd_${i}"\n`);
    }
    const tomlPath = join(baseTmp, "huge-config.toml");
    await writeFile(tomlPath, serversToml.join("\n"), "utf8");

    const hugeRef: ConfigurationReference = {
      id: "cfg-huge",
      toolId: "codex",
      label: "huge-config.toml",
      path: tomlPath,
      canonicalPath: tomlPath,
      exists: true,
    };

    const result = await codexAdapter.discoverMcpServers([], [hugeRef]);
    assert.equal(result.state, "ready");
    assert.equal(result.items.length, MAX_MCP_SERVERS);
    assert.equal(result.truncated, true);
  } finally {
    await rm(baseTmp, { recursive: true, force: true });
  }
});
