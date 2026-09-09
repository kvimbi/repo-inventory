import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { spawn } from "node:child_process";
import { AGENT_TOOL_IDS, type AgentToolId, type OpenConfigurationRequest } from "../../core/types.ts";
import { createApp } from "../index.ts";
import { AgentToolsCatalog } from "./catalog.ts";
import { AgentToolsService } from "./service.ts";
import { discoverTools } from "./discovery.ts";
import {
  SessionHistoryCatalog,
  OpenCodeHistorySource,
  CodexHistorySource,
  sessionReference,
} from "../sessionHistory/index.ts";
import { InventoryService } from "../service.ts";

interface SpawnCallRecord {
  launcher: string;
  args: ReadonlyArray<string>;
  options: { shell?: boolean };
}

interface TestFixture {
  rootDir: string;
  fakeHome: string;
  projectDir: string;
  externalDir: string;
  agentToolsService: AgentToolsService;
  spawnCalls: SpawnCallRecord[];
  cleanup: () => Promise<void>;
}

const LEAK_CANARIES = [
  "ghp_super_secret_pat_9876543210",
  "very_secret_db_pass_555",
  "url_token_9999",
  "bearer_secret_token_xyz",
  "secret_arg_key_abc123",
  "opencode_secret_key_777",
  "brave_secret_key_888",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
  "Authorization",
  "Bearer",
];

async function setupIntegrationFixture(options?: {
  malformedCodexConfig?: boolean;
}): Promise<TestFixture> {
  const rootDir = await mkdtemp(join(tmpdir(), "agent-tools-integration-"));
  const fakeHome = join(rootDir, "home");
  const projectDir = join(rootDir, "my-project");
  const externalDir = join(rootDir, "external-folder");

  await mkdir(fakeHome, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await mkdir(externalDir, { recursive: true });

  // 1. Codex setup
  const codexDir = join(fakeHome, ".codex");
  await mkdir(join(codexDir, "skills", "deploy-helper"), { recursive: true });
  await mkdir(join(codexDir, "sessions"), { recursive: true });

  if (options?.malformedCodexConfig) {
    await writeFile(join(codexDir, "config.toml"), "invalid = [ [ syntax error", "utf8");
  } else {
    const codexConfigToml = `
[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github", "--token", "ghp_super_secret_pat_9876543210"]

[mcp_servers.github.env]
GITHUB_PERSONAL_ACCESS_TOKEN = "ghp_super_secret_pat_9876543210"
DATABASE_PASSWORD = "very_secret_db_pass_555"

[mcp_servers.weather]
url = "https://mcp.weather.internal/sse?token=url_token_9999"

[mcp_servers.weather.headers]
Authorization = "Bearer bearer_secret_token_xyz"
`;
    await writeFile(join(codexDir, "config.toml"), codexConfigToml, "utf8");
  }

  await writeFile(join(codexDir, "instructions.md"), "# Codex Instructions\nFollow conventions.\n", "utf8");
  await writeFile(
    join(codexDir, "skills", "deploy-helper", "SKILL.md"),
    "---\nname: Deploy Helper\ndescription: Deployment assistant\n---\nDeploy steps\n",
    "utf8",
  );

  // 2. OpenCode setup
  const opencodeDir = join(fakeHome, ".config", "opencode");
  await mkdir(join(opencodeDir, "agents"), { recursive: true });
  await mkdir(join(opencodeDir, "skills", "code-review"), { recursive: true });

  const opencodeJson = `
{
  "mcp": {
    "servers": {
      "sqlite": {
        "command": "uvx",
        "args": ["mcp-server-sqlite", "--db-path", "/secret/db.sqlite", "secret_arg_key_abc123"],
        "env": {
          "SECRET_KEY": "opencode_secret_key_777"
        }
      }
    }
  }
}
`;
  await writeFile(join(opencodeDir, "opencode.json"), opencodeJson, "utf8");
  await writeFile(join(opencodeDir, "INSTRUCTIONS.md"), "# OpenCode Instructions\nBe concise.\n", "utf8");
  await writeFile(
    join(opencodeDir, "agents", "architect.json"),
    JSON.stringify({ name: "Architect", description: "System architect agent" }, null, 2),
    "utf8",
  );
  await writeFile(
    join(opencodeDir, "skills", "code-review", "SKILL.md"),
    "---\nname: Code Reviewer\ndescription: Reviews code\n---\nReview guidelines\n",
    "utf8",
  );

  // OpenCode SQLite session store
  const opencodeDbPath = join(fakeHome, ".local", "share", "opencode", "opencode.db");
  await mkdir(join(fakeHome, ".local", "share", "opencode"), { recursive: true });
  const db = new DatabaseSync(opencodeDbPath);
  db.exec("CREATE TABLE session (id text PRIMARY KEY, title text, directory text, parent_id text, time_created integer, time_updated integer)");
  db.exec("CREATE TABLE message (id text PRIMARY KEY, session_id text, time_created integer, time_updated integer, data text)");
  db.exec("CREATE TABLE part (id text PRIMARY KEY, message_id text, session_id text, time_created integer, time_updated integer, data text)");

  const now = Date.now();
  // Session 1: inside projectDir with available transcript
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run(
    "sess-project-1",
    "Project Session One",
    projectDir,
    null,
    now - 10000,
    now - 5000,
  );
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
    "msg-1",
    "sess-project-1",
    now - 9000,
    now - 9000,
    JSON.stringify({ role: "user" }),
  );
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(
    "part-1",
    "msg-1",
    "sess-project-1",
    now - 9000,
    now - 9000,
    JSON.stringify({ type: "text", text: "Please review the build." }),
  );

  // Session 2: inside externalDir (for boundary confinement verification)
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run(
    "sess-external-2",
    "External Session Two",
    externalDir,
    null,
    now - 20000,
    now - 15000,
  );
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
    "msg-2",
    "sess-external-2",
    now - 19000,
    now - 19000,
    JSON.stringify({ role: "user" }),
  );
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(
    "part-2",
    "msg-2",
    "sess-external-2",
    now - 19000,
    now - 19000,
    JSON.stringify({ type: "text", text: "Working in external directory." }),
  );

  db.close();

  // 3. Claude setup
  const claudeDesktopDir = join(fakeHome, "Library", "Application Support", "Claude");
  await mkdir(claudeDesktopDir, { recursive: true });
  const claudeDesktopJson = `
{
  "mcpServers": {
    "brave": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "brave_secret_key_888"
      }
    }
  }
}
`;
  await writeFile(join(claudeDesktopDir, "claude_desktop_config.json"), claudeDesktopJson, "utf8");

  const claudeCliDir = join(fakeHome, ".claude");
  await mkdir(claudeCliDir, { recursive: true });
  await writeFile(join(claudeCliDir, "CLAUDE.md"), "# Claude Instructions\nPreserve integrity.\n", "utf8");

  // 4. Antigravity setup
  const agyDir = join(fakeHome, ".gemini", "antigravity");
  await mkdir(agyDir, { recursive: true });
  await writeFile(join(agyDir, "instructions.md"), "# Antigravity Instructions\nSandbox safe.\n", "utf8");

  // 5. Gemini setup
  const geminiDir = join(fakeHome, ".gemini");
  await writeFile(join(geminiDir, "GEMINI.md"), "# Gemini Instructions\nCommand-line tool.\n", "utf8");

  // Mock spawner
  const spawnCalls: SpawnCallRecord[] = [];
  const mockSpawn = (
    launcher: string,
    args: ReadonlyArray<string>,
    options: { shell?: boolean },
  ) => {
    spawnCalls.push({ launcher, args, options });
    const emitter = new EventEmitter();
    queueMicrotask(() => {
      emitter.emit("close", 0);
    });
    return emitter as unknown as ReturnType<typeof spawn>;
  };

  const historyCatalog = new SessionHistoryCatalog([
    new OpenCodeHistorySource(opencodeDbPath),
    new CodexHistorySource(codexDir),
  ]);

  const catalog = new AgentToolsCatalog(
    () => discoverTools(fakeHome),
    historyCatalog,
    async () => [{ id: "proj-1", name: "My Project", path: projectDir }],
    mockSpawn,
  );

  const agentToolsService = new AgentToolsService(catalog);

  return {
    rootDir,
    fakeHome,
    projectDir,
    externalDir,
    agentToolsService,
    spawnCalls,
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

let sharedFixture: TestFixture | null = null;

async function getSharedFixture(): Promise<TestFixture> {
  if (!sharedFixture) {
    sharedFixture = await setupIntegrationFixture();
  }
  return sharedFixture;
}

test.after(async () => {
  if (sharedFixture) {
    await sharedFixture.cleanup();
    sharedFixture = null;
  }
});

function createIpcBridge(service: AgentToolsService) {
  return {
    async list() {
      return service.listTools();
    },
    async refresh() {
      return service.refresh();
    },
    async getDetails(id: AgentToolId) {
      return service.getToolDetails(id);
    },
    async readResource(ref: string) {
      return service.readResource(ref);
    },
    async openConfiguration(req: OpenConfigurationRequest) {
      return service.openConfiguration(req.ref, req.action, req.ide);
    },
    async readSessionTranscript(id: string, cursor?: string) {
      return service.readSessionTranscript(id, cursor);
    },
  };
}

test("HTTP and IPC parity: GET /api/agent-tools vs agentTools:list", async () => {
  const fixture = await getSharedFixture();
  const { app } = await createApp({
    baseDir: fixture.rootDir,
    agentToolsService: fixture.agentToolsService,
  });
  const ipc = createIpcBridge(fixture.agentToolsService);

  const httpRes = await app.inject({ method: "GET", url: "/api/agent-tools" });
  assert.equal(httpRes.statusCode, 200);
  const httpBody = httpRes.json() as { tools: unknown[] };

  const ipcBody = await ipc.list();

  assert.deepEqual(httpBody.tools, ipcBody);
  assert.equal(httpBody.tools.length, 5);
  const ids = ipcBody.map((t) => t.id);
  assert.deepEqual(ids, AGENT_TOOL_IDS);
});

test("HTTP and IPC parity: POST /api/agent-tools/refresh vs agentTools:refresh (cache invalidation)", async () => {
  const fixture = await getSharedFixture();
  let probeCount = 0;
  const catalog = new AgentToolsCatalog(
    async () => {
      probeCount += 1;
      return discoverTools(fixture.fakeHome);
    },
    undefined,
    undefined,
  );
  const service = new AgentToolsService(catalog);
  const { app } = await createApp({
    baseDir: fixture.rootDir,
    agentToolsService: service,
  });
  const ipc = createIpcBridge(service);

  // Initial probe
  const initialHttp = await app.inject({ method: "GET", url: "/api/agent-tools" });
  assert.equal(initialHttp.statusCode, 200);
  assert.equal(probeCount, 1);

  // Second GET uses in-memory cache without re-probing
  const cachedHttp = await app.inject({ method: "GET", url: "/api/agent-tools" });
  assert.equal(cachedHttp.statusCode, 200);
  assert.equal(probeCount, 1);

  // POST /api/agent-tools/refresh forces re-probe
  const refreshHttp = await app.inject({ method: "POST", url: "/api/agent-tools/refresh" });
  assert.equal(refreshHttp.statusCode, 200);
  assert.equal(probeCount, 2);

  // IPC refresh also invalidates and re-probes
  const ipcRefreshed = await ipc.refresh();
  assert.equal(probeCount, 3);

  // Parity check across all tools ignoring dynamic probedAt timestamp
  const sanitize = (tools: Array<{ id: string; name: string; installation: { probedAt: string } }>) =>
    tools.map((t) => ({ ...t, installation: { ...t.installation, probedAt: "" } }));
  assert.deepEqual(sanitize(refreshHttp.json().tools), sanitize(ipcRefreshed));
});

test("HTTP and IPC parity: GET /api/agent-tools/:id vs agentTools:getDetails (valid, 400, and 404)", async () => {
  const fixture = await getSharedFixture();
  const { app } = await createApp({
    baseDir: fixture.rootDir,
    agentToolsService: fixture.agentToolsService,
  });
  const ipc = createIpcBridge(fixture.agentToolsService);

  for (const toolId of AGENT_TOOL_IDS) {
    const httpRes = await app.inject({ method: "GET", url: `/api/agent-tools/${toolId}` });
    assert.equal(httpRes.statusCode, 200);
    const httpData = httpRes.json();
    const ipcData = await ipc.getDetails(toolId);
    assert.deepEqual(httpData, JSON.parse(JSON.stringify(ipcData)));
    assert.equal(httpData.summary.id, toolId);
  }

  // Invalid tool id (not in AGENT_TOOL_IDS) returns 400 in HTTP and null in IPC
  const invalidRes = await app.inject({ method: "GET", url: "/api/agent-tools/nonexistent-tool" });
  assert.equal(invalidRes.statusCode, 400);
  assert.match(invalidRes.json().error, /Invalid agent tool id/);

  // @ts-expect-error testing invalid id
  const ipcInvalid = await ipc.getDetails("nonexistent-tool");
  assert.equal(ipcInvalid, null);
});

test("HTTP and IPC parity: GET /api/agent-tools/resources/preview vs agentTools:readResource (preview & 404)", async () => {
  const fixture = await getSharedFixture();
  const { app } = await createApp({
    baseDir: fixture.rootDir,
    agentToolsService: fixture.agentToolsService,
  });
  const ipc = createIpcBridge(fixture.agentToolsService);

  const codexDetails = await fixture.agentToolsService.getToolDetails("codex");
  assert.ok(codexDetails);
  assert.ok(codexDetails.skills.items.length > 0);
  const validSkillRef = codexDetails.skills.items[0].id;

  // 1. Valid preview
  const httpRes = await app.inject({
    method: "GET",
    url: `/api/agent-tools/resources/preview?ref=${encodeURIComponent(validSkillRef)}`,
  });
  assert.equal(httpRes.statusCode, 200);
  const httpPreview = httpRes.json();
  const ipcPreview = await ipc.readResource(validSkillRef);

  assert.deepEqual(httpPreview, ipcPreview);
  assert.equal(httpPreview.name, "Deploy Helper");
  assert.equal(httpPreview.isMarkdown, true);

  // 2. Unknown ref returns 404 in HTTP and rejects in IPC
  const unknownRef = "unknown-resource-ref-999";
  const unknownHttp = await app.inject({
    method: "GET",
    url: `/api/agent-tools/resources/preview?ref=${encodeURIComponent(unknownRef)}`,
  });
  assert.equal(unknownHttp.statusCode, 404);
  assert.match(unknownHttp.json().error, /Unknown resource reference/);

  await assert.rejects(async () => {
    await ipc.readResource(unknownRef);
  }, /Unknown resource reference/);

  // 3. Missing query parameter returns 400 in HTTP
  const missingParamHttp = await app.inject({
    method: "GET",
    url: "/api/agent-tools/resources/preview",
  });
  assert.equal(missingParamHttp.statusCode, 400);
  assert.match(missingParamHttp.json().error, /Missing required query parameter: ref/);
});

test("HTTP and IPC parity: POST /api/agent-tools/config/open vs agentTools:openConfiguration (validation and spawn)", async () => {
  const fixture = await getSharedFixture();
  const { app } = await createApp({
    baseDir: fixture.rootDir,
    agentToolsService: fixture.agentToolsService,
  });
  const ipc = createIpcBridge(fixture.agentToolsService);

  const codexDetails = await fixture.agentToolsService.getToolDetails("codex");
  assert.ok(codexDetails);
  const cfgRef = codexDetails.configurations.find((c) => c.exists)?.id;
  assert.ok(cfgRef);

  // 1. Valid editor action via HTTP
  fixture.spawnCalls.length = 0;
  const httpEditorRes = await app.inject({
    method: "POST",
    url: "/api/agent-tools/config/open",
    payload: { ref: cfgRef, action: "editor" },
  });
  assert.equal(httpEditorRes.statusCode, 200);
  assert.deepEqual(httpEditorRes.json(), { ok: true });
  assert.equal(fixture.spawnCalls.length, 1);
  assert.equal(fixture.spawnCalls[0].args[0], "-t");
  assert.equal(fixture.spawnCalls[0].options?.shell, false);

  // 2. Valid reveal action via IPC
  fixture.spawnCalls.length = 0;
  const ipcRevealRes = await ipc.openConfiguration({ ref: cfgRef, action: "reveal" });
  assert.deepEqual(ipcRevealRes, { ok: true });
  assert.equal(fixture.spawnCalls.length, 1);
  assert.equal(fixture.spawnCalls[0].args[0], "-R");
  assert.equal(fixture.spawnCalls[0].options?.shell, false);

  // 3. Valid selected IDE via HTTP and IPC
  fixture.spawnCalls.length = 0;
  const httpIdeRes = await app.inject({
    method: "POST",
    url: "/api/agent-tools/config/open",
    payload: { ref: cfgRef, action: "editor", ide: "code" },
  });
  assert.deepEqual(httpIdeRes.json(), { ok: true });
  assert.equal(fixture.spawnCalls[0].launcher, "code");
  assert.equal(fixture.spawnCalls[0].args.at(-1), codexDetails.configurations.find((c) => c.id === cfgRef)?.canonicalPath);
  assert.equal(fixture.spawnCalls[0].options?.shell, false);

  fixture.spawnCalls.length = 0;
  const ipcIdeRes = await ipc.openConfiguration({ ref: cfgRef, action: "editor", ide: "code" });
  assert.deepEqual(ipcIdeRes, { ok: true });
  assert.equal(fixture.spawnCalls[0].launcher, "code");

  fixture.spawnCalls.length = 0;
  const finderRes = await ipc.openConfiguration({ ref: cfgRef, action: "editor", ide: "finder" });
  assert.deepEqual(finderRes, { ok: true });
  assert.equal(fixture.spawnCalls[0].args[0], "-R");
  assert.equal(fixture.spawnCalls[0].args.at(-1), codexDetails.configurations.find((c) => c.id === cfgRef)?.canonicalPath);

  // 4. Unknown ref rejection
  const unknownRes = await app.inject({
    method: "POST",
    url: "/api/agent-tools/config/open",
    payload: { ref: "nonexistent-ref", action: "editor" },
  });
  assert.equal(unknownRes.statusCode, 200);
  assert.equal(unknownRes.json().ok, false);
  assert.match(unknownRes.json().message, /Unknown configuration reference/);

  const ipcUnknown = await ipc.openConfiguration({ ref: "nonexistent-ref", action: "editor" });
  assert.equal(ipcUnknown.ok, false);
  assert.match(ipcUnknown.message ?? "", /Unknown configuration reference/);

  // 5. Previewable file resources use the same validated opener
  const skillRef = codexDetails.skills.items[0]?.id;
  assert.ok(skillRef);
  const skillOpenRes = await app.inject({
    method: "POST",
    url: "/api/agent-tools/config/open",
    payload: { ref: skillRef, action: "editor", ide: "code" },
  });
  assert.equal(skillOpenRes.statusCode, 200);
  assert.equal(skillOpenRes.json().ok, true);

  // 6. Invalid IDE is rejected before launch
  const invalidIde = await ipc.openConfiguration({ ref: cfgRef, action: "editor", ide: "unknown-ide" });
  assert.equal(invalidIde.ok, false);
  assert.match(invalidIde.message ?? "", /Unknown IDE/);

  // 7. Invalid action returns 400 on HTTP and failure on IPC
  const invalidActionHttp = await app.inject({
    method: "POST",
    url: "/api/agent-tools/config/open",
    payload: { ref: cfgRef, action: "destroy" },
  });
  assert.equal(invalidActionHttp.statusCode, 400);

  // @ts-expect-error testing invalid action
  const invalidActionIpc = await ipc.openConfiguration({ ref: cfgRef, action: "destroy" });
  assert.equal(invalidActionIpc.ok, false);
  assert.match(invalidActionIpc.message ?? "", /Invalid action/);
});

test("HTTP and IPC parity: GET /api/agent-tools/sessions/:id/transcript vs agentTools:readSessionTranscript", async () => {
  const fixture = await getSharedFixture();
  const { app } = await createApp({
    baseDir: fixture.rootDir,
    agentToolsService: fixture.agentToolsService,
  });
  const ipc = createIpcBridge(fixture.agentToolsService);

  const opencodeDetails = await fixture.agentToolsService.getToolDetails("opencode");
  assert.ok(opencodeDetails);
  assert.equal(opencodeDetails.recentSessions.state, "ready");
  assert.ok(opencodeDetails.recentSessions.items.length > 0);

  const sessionId = opencodeDetails.recentSessions.items[0].id;

  // 1. Available session transcript
  const httpRes = await app.inject({
    method: "GET",
    url: `/api/agent-tools/sessions/${encodeURIComponent(sessionId)}/transcript`,
  });
  assert.equal(httpRes.statusCode, 200);
  const httpTranscript = httpRes.json();
  const ipcTranscript = await ipc.readSessionTranscript(sessionId);

  assert.deepEqual(httpTranscript, JSON.parse(JSON.stringify(ipcTranscript)));
  assert.equal(httpTranscript.available, true);
  assert.ok(httpTranscript.entries.length > 0);

  // 2. Unavailable transcript handling: missing session returns available: false and "Local transcript unavailable."
  const missingCodexId = sessionReference("codex", "missing-session-uuid");
  const missingHttp = await app.inject({
    method: "GET",
    url: `/api/agent-tools/sessions/${encodeURIComponent(missingCodexId)}/transcript`,
  });
  assert.equal(missingHttp.statusCode, 200);
  const missingJson = missingHttp.json();
  assert.equal(missingJson.available, false);
  assert.equal(missingJson.reason, "Local transcript unavailable.");
  const missingIpc = await ipc.readSessionTranscript(missingCodexId);
  assert.deepEqual(missingJson, JSON.parse(JSON.stringify(missingIpc)));

  // 3. Invalid/corrupted cursor returns 404 in HTTP and rejects in IPC
  const invalidCursorHttp = await app.inject({
    method: "GET",
    url: `/api/agent-tools/sessions/${encodeURIComponent(sessionId)}/transcript?cursor=corrupted-cursor-token`,
  });
  assert.equal(invalidCursorHttp.statusCode, 404);
  assert.match(invalidCursorHttp.json().error, /invalid history cursor/);
  await assert.rejects(async () => {
    await ipc.readSessionTranscript(sessionId, "corrupted-cursor-token");
  }, /invalid history cursor/);
});

test("Failure & Disconnection Isolation: Agent Tools remains fully operational when repository inventory fails", async () => {
  const fixture = await getSharedFixture();
  const brokenInventoryService = new InventoryService(fixture.rootDir);
  // Force inventory scan to throw
  brokenInventoryService.getInventory = async () => {
    throw new Error("Repository inventory service completely disconnected / failed");
  };

  const catalog = new AgentToolsCatalog(
    () => discoverTools(fixture.fakeHome),
    undefined,
    async () => {
      try {
        const inv = await brokenInventoryService.getInventory();
        return inv.projects.map((p) => ({ id: p.id, name: p.name, path: p.path }));
      } catch {
        return [];
      }
    },
  );
  const agentToolsService = new AgentToolsService(catalog);

  const { app } = await createApp({
    baseDir: fixture.rootDir,
    inventoryService: brokenInventoryService,
    agentToolsService,
  });

  // 1. GET /api/agent-tools remains 200
  const listRes = await app.inject({ method: "GET", url: "/api/agent-tools" });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.json().tools.length, 5);

  // 2. POST /api/agent-tools/refresh remains 200
  const refreshRes = await app.inject({ method: "POST", url: "/api/agent-tools/refresh" });
  assert.equal(refreshRes.statusCode, 200);

  // 3. Tool details and recent sessions succeed without crashing
  const codexRes = await app.inject({ method: "GET", url: "/api/agent-tools/codex" });
  assert.equal(codexRes.statusCode, 200);
  assert.equal(codexRes.json().summary.name, "Codex");

  const opencodeRes = await app.inject({ method: "GET", url: "/api/agent-tools/opencode" });
  assert.equal(opencodeRes.statusCode, 200);
  assert.equal(opencodeRes.json().summary.name, "OpenCode");
});

test("Failure & Disconnection Isolation: Malformed config in one tool isolates error and preserves other tools", async () => {
  const fixture = await setupIntegrationFixture({ malformedCodexConfig: true });
  try {
    const { app } = await createApp({
      baseDir: fixture.rootDir,
      agentToolsService: fixture.agentToolsService,
    });

    // 1. All 5 tools are still listed
    const listRes = await app.inject({ method: "GET", url: "/api/agent-tools" });
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.json().tools.length, 5);

    // 2. OpenCode details are unaffected and fully ready
    const opencodeRes = await app.inject({ method: "GET", url: "/api/agent-tools/opencode" });
    assert.equal(opencodeRes.statusCode, 200);
    const opencodeDetails = opencodeRes.json();
    assert.equal(opencodeDetails.summary.id, "opencode");
    assert.equal(opencodeDetails.mcpServers.state, "ready");
    assert.equal(opencodeDetails.skills.state, "ready");
    assert.equal(opencodeDetails.subagents.state, "ready");

    // 3. Claude details are also unaffected
    const claudeRes = await app.inject({ method: "GET", url: "/api/agent-tools/claude" });
    assert.equal(claudeRes.statusCode, 200);
    assert.equal(claudeRes.json().summary.id, "claude");
    assert.equal(claudeRes.json().mcpServers.state, "ready");

    // 4. Codex isolated error: MCP is in error state, but tool query doesn't crash server
    const codexRes = await app.inject({ method: "GET", url: "/api/agent-tools/codex" });
    assert.equal(codexRes.statusCode, 200);
    const codexDetails = codexRes.json();
    assert.equal(codexDetails.mcpServers.state, "error");
    assert.match(codexDetails.mcpServers.reason ?? "", /TOML parse error/);
  } finally {
    await fixture.cleanup();
  }
});

test("Zero Credential Leak Invariant: responses contain zero args, zero env vars, zero headers, zero query secrets", async () => {
  const fixture = await getSharedFixture();
  const { app } = await createApp({
    baseDir: fixture.rootDir,
    agentToolsService: fixture.agentToolsService,
  });

  const serializedPayloads: string[] = [];

  // List tools
  const listRes = await app.inject({ method: "GET", url: "/api/agent-tools" });
  serializedPayloads.push(listRes.body);

  // Refresh tools
  const refreshRes = await app.inject({ method: "POST", url: "/api/agent-tools/refresh" });
  serializedPayloads.push(refreshRes.body);

  // Details for each tool
  for (const toolId of AGENT_TOOL_IDS) {
    const detailsRes = await app.inject({ method: "GET", url: `/api/agent-tools/${toolId}` });
    serializedPayloads.push(detailsRes.body);

    const details = detailsRes.json();
    // Ensure MCP server declarations only expose allowlisted fields
    if (details.mcpServers && details.mcpServers.items) {
      for (const mcp of details.mcpServers.items) {
        const keys = Object.keys(mcp);
        const allowedKeys = new Set([
          "id",
          "name",
          "toolId",
          "transport",
          "state",
          "configRefId",
          "sourcePath",
          "duplicate",
          "conflict",
        ]);
        for (const key of keys) {
          assert.ok(
            allowedKeys.has(key),
            `Forbidden key '${key}' leaked in MCP server declaration: ${JSON.stringify(mcp)}`,
          );
        }
        // Explicit checks that dangerous credential containers are completely omitted
        assert.equal(mcp.args, undefined);
        assert.equal(mcp.env, undefined);
        assert.equal(mcp.headers, undefined);
        assert.equal(mcp.url, undefined);
        assert.equal(mcp.command, undefined);
      }
    }
  }

  // Verify all payloads against secret canaries
  const fullCombinedJson = serializedPayloads.join("\n");
  for (const canary of LEAK_CANARIES) {
    assert.equal(
      fullCombinedJson.includes(canary),
      false,
      `Credential or sensitive token leaked in HTTP/IPC payload! Leaked value: ${canary}`,
    );
  }
});

test("Guidance Review regression safety: project checkout boundary confinement is strictly enforced", async () => {
  const fixture = await getSharedFixture();
  const historyCatalog = new SessionHistoryCatalog([
    new OpenCodeHistorySource(join(fixture.fakeHome, ".local", "share", "opencode", "opencode.db")),
  ]);

  // 1. Session in projectDir can be accessed with project checkout
  const projectSessId = sessionReference("opencode", "sess-project-1");
  const projectHistory = await historyCatalog.getHistory(fixture.projectDir, projectSessId);
  assert.equal(projectHistory.entries.length, 1);

  // 2. Session in externalDir CANNOT be accessed with projectDir checkout (boundary confinement)
  const externalSessId = sessionReference("opencode", "sess-external-2");
  await assert.rejects(
    async () => {
      await historyCatalog.getHistory(fixture.projectDir, externalSessId);
    },
    {
      name: "Error",
      message: /session is not associated with this checkout/,
    },
  );

  // 3. But global history retrieval for Agent Tools can read it without checkout confinement
  const globalHistory = await historyCatalog.getGlobalHistory(externalSessId);
  assert.equal(globalHistory.available, true);
  assert.equal(globalHistory.entries.length, 1);
});
