import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  GuidanceHistoryCatalog,
  SessionHistoryCatalog,
  OpenCodeHistorySource,
  ClaudeHistorySource,
  CoworkHistorySource,
  CodexHistorySource,
  sessionReference,
} from "./index.ts";

async function createTestEnvironment() {
  const root = await mkdtemp(resolve(tmpdir(), "session-history-test-"));

  // 1. Known projects and external folders
  const projectAlpha = resolve(root, "project-alpha");
  const externalFolder = resolve(root, "external-folder");
  await mkdir(projectAlpha, { recursive: true });
  await mkdir(externalFolder, { recursive: true });

  // 2. OpenCode SQLite setup
  const opencodeDbPath = resolve(root, "opencode.db");
  const db = new DatabaseSync(opencodeDbPath);
  db.exec("CREATE TABLE session (id text PRIMARY KEY, title text, directory text, parent_id text, time_created integer, time_updated integer)");
  db.exec("CREATE TABLE message (id text PRIMARY KEY, session_id text, time_created integer, time_updated integer, data text)");
  db.exec("CREATE TABLE part (id text PRIMARY KEY, message_id text, session_id text, time_created integer, time_updated integer, data text)");

  const now = Date.now();
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run(
    "opencode-sess-1",
    "OpenCode Project Session",
    projectAlpha,
    null,
    now - 5000,
    now - 1000
  );
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run(
    "opencode-sess-2",
    "OpenCode External Session",
    externalFolder,
    null,
    now - 6000,
    now - 2000
  );
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run(
    "opencode-sess-3",
    "OpenCode Projectless Session",
    "/non/existent/path",
    null,
    now - 7000,
    now - 3000
  );

  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("msg-1", "opencode-sess-1", now, now, JSON.stringify({ role: "user" }));
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run("part-1", "msg-1", "opencode-sess-1", now, now, JSON.stringify({ type: "text", text: "Hello OpenCode" }));
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run("part-2", "msg-1", "opencode-sess-1", now + 1, now + 1, JSON.stringify({ type: "tool", tool: "read_file", state: { status: "success", input: { path: "foo.txt" }, output: "file contents" } }));
  db.close();

  // 3. Codex setup
  const codexHome = resolve(root, "codex");
  const codexSessionsDir = resolve(codexHome, "sessions");
  const codexArchivedDir = resolve(codexHome, "archived_sessions");
  await mkdir(codexSessionsDir, { recursive: true });
  await mkdir(codexArchivedDir, { recursive: true });

  const codexRollout1 = resolve(codexSessionsDir, "rollout-codex-1.jsonl");
  const codexContent1 = [
    JSON.stringify({ type: "session_meta", payload: { id: "codex-sess-1", cwd: projectAlpha, timestamp: new Date(now - 4000).toISOString(), history_mode: "rollout" } }),
    JSON.stringify({ type: "response_item", payload: { id: "msg-1", type: "message", role: "user", content: "Codex test user" } }),
    JSON.stringify({ type: "response_item", payload: { id: "msg-2", type: "message", role: "assistant", content: "Codex test assistant" } }),
  ].join("\n");
  await writeFile(codexRollout1, `${codexContent1}\n`, "utf8");

  // State sqlite for codex thread metadata
  const stateDb = new DatabaseSync(resolve(codexHome, "state_5.sqlite"));
  stateDb.exec("CREATE TABLE threads (id text PRIMARY KEY, title text, name text, created_at integer, updated_at integer)");
  stateDb.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?)").run(
    "codex-sess-1",
    "Codex Refactoring Thread",
    "Thread 1",
    now - 4000,
    now - 1500
  );
  stateDb.close();

  // 4. Claude Code setup
  const claudeRoot = resolve(root, "claude");
  const claudeDesktopRoot = resolve(root, "claude-desktop-empty");
  await mkdir(claudeDesktopRoot, { recursive: true });
  const claudeProjects = resolve(claudeRoot, "projects");
  const claudeProjDir = resolve(claudeProjects, "-project-alpha");
  await mkdir(claudeProjDir, { recursive: true });

  const claudeTranscriptPath = resolve(claudeProjDir, "claude-sess-1.jsonl");
  const claudeRecords = [
    JSON.stringify({ type: "user", uuid: "u1", sessionId: "claude-sess-1", cwd: projectAlpha, timestamp: new Date(now - 500).toISOString(), message: { role: "user", content: "Run Claude test" } }),
    JSON.stringify({ type: "assistant", uuid: "a1", sessionId: "claude-sess-1", timestamp: new Date(now - 400).toISOString(), message: { role: "assistant", content: [{ type: "text", text: "Claude response" }] } }),
  ].join("\n");
  await writeFile(claudeTranscriptPath, `${claudeRecords}\n`, "utf8");

  await writeFile(
    resolve(claudeProjDir, ".session_cache.json"),
    JSON.stringify({
      version: 8,
      entries: {
        [claudeTranscriptPath]: {
          session: {
            session_id: "claude-sess-1",
            actual_session_id: "claude-sess-1",
            file_path: claudeTranscriptPath,
            summary: "Claude Active Session",
          },
        },
      },
    }),
    "utf8"
  );

  // 5. Cowork setup
  const coworkRoot = resolve(root, "cowork");
  const coworkSessionDir = resolve(coworkRoot, "user-acct", "org-1", "local_cowork-1");
  await mkdir(coworkSessionDir, { recursive: true });

  const coworkMetaPath = resolve(coworkRoot, "user-acct", "org-1", "local_cowork-1.json");
  await writeFile(
    coworkMetaPath,
    JSON.stringify({
      sessionId: "local_cowork-1",
      cliSessionId: "cowork-cli-1",
      title: "Cowork Session",
      cwd: projectAlpha,
      userSelectedFolders: [projectAlpha],
      createdAt: new Date(now - 2000).toISOString(),
      updatedAt: new Date(now - 800).toISOString(),
    }),
    "utf8"
  );

  const coworkClaudeProjects = resolve(coworkSessionDir, ".claude/projects/sub-proj");
  await mkdir(coworkClaudeProjects, { recursive: true });
  const coworkTranscriptPath = resolve(coworkClaudeProjects, "cowork-cli-1.jsonl");
  const coworkRecords = [
    JSON.stringify({ type: "user", uuid: "cu1", sessionId: "cowork-cli-1", cwd: projectAlpha, timestamp: new Date(now - 800).toISOString(), message: { role: "user", content: "Cowork prompt" } }),
  ].join("\n");
  await writeFile(coworkTranscriptPath, `${coworkRecords}\n`, "utf8");

  const opencodeSource = new OpenCodeHistorySource(opencodeDbPath);
  const codexSource = new CodexHistorySource(codexHome);
  const claudeSource = new ClaudeHistorySource(claudeRoot, claudeDesktopRoot);
  const coworkSource = new CoworkHistorySource(coworkRoot);

  const catalog = new GuidanceHistoryCatalog([opencodeSource, codexSource, claudeSource, coworkSource]);

  const knownProjects = [
    { id: "proj-alpha", name: "Project Alpha", path: projectAlpha },
  ];

  return {
    root,
    projectAlpha,
    externalFolder,
    opencodeSource,
    codexSource,
    claudeSource,
    coworkSource,
    catalog,
    knownProjects,
  };
}

test("global session listing across OpenCode, Codex, Claude, and Cowork sources", async () => {
  const env = await createTestEnvironment();

  // OpenCode
  const opencodeSessions = await env.opencodeSource.listGlobalRecentSessions(10);
  assert.equal(opencodeSessions.length, 3);
  assert.equal(opencodeSessions[0].client, "OpenCode");
  assert.equal(opencodeSessions[0].title, "OpenCode Project Session");

  // Codex
  const codexSessions = await env.codexSource.listGlobalRecentSessions(10);
  assert.equal(codexSessions.length, 1);
  assert.equal(codexSessions[0].client, "Codex");
  assert.equal(codexSessions[0].title, "Codex Refactoring Thread");
  assert.equal(codexSessions[0].nativeSessionId, "codex-sess-1");

  // Claude Code
  const claudeSessions = await env.claudeSource.listGlobalRecentSessions(10);
  assert.equal(claudeSessions.length, 1);
  assert.equal(claudeSessions[0].client, "Claude Code");
  assert.equal(claudeSessions[0].title, "Claude Active Session");

  // Cowork
  const coworkSessions = await env.coworkSource.listGlobalRecentSessions(10);
  assert.equal(coworkSessions.length, 1);
  assert.equal(coworkSessions[0].client, "Claude Cowork (local)");
  assert.equal(coworkSessions[0].title, "Cowork Session");
});

test("project association matching with known projects list: known_project, external_folder, projectless", async () => {
  const env = await createTestEnvironment();

  const res = await env.catalog.listGlobalRecentSessions("opencode", 50, env.knownProjects);
  assert.equal(res.state, "ready");
  assert.equal(res.items.length, 3);

  // 1. known_project match
  const known = res.items.find((item) => item.title === "OpenCode Project Session");
  assert.ok(known);
  assert.equal(known.projectAssociation?.kind, "known_project");
  assert.equal(known.projectAssociation?.projectId, "proj-alpha");
  assert.equal(known.projectAssociation?.name, "Project Alpha");

  // 2. external_folder match (folder exists on disk, not in knownProjects)
  const external = res.items.find((item) => item.title === "OpenCode External Session");
  assert.ok(external);
  assert.equal(external.projectAssociation?.kind, "external_folder");
  assert.equal(external.projectAssociation?.path, env.externalFolder);

  // 3. projectless match (non-existent path)
  const projectless = res.items.find((item) => item.title === "OpenCode Projectless Session");
  assert.ok(projectless);
  assert.equal(projectless.projectAssociation?.kind, "projectless");
});

test("read-only transcript retrieval without checkout confinement", async () => {
  const env = await createTestEnvironment();

  const openCodeRef = sessionReference("opencode", "opencode-sess-1");
  const openCodeHistory = await env.catalog.getGlobalHistory(openCodeRef);
  assert.equal(openCodeHistory.available, true);
  assert.ok(openCodeHistory.entries.length >= 2);
  assert.equal(openCodeHistory.entries[0].text, "Hello OpenCode");

  const codexRef = sessionReference("codex", "codex-sess-1");
  const codexHistory = await env.catalog.getGlobalHistory(codexRef);
  assert.equal(codexHistory.available, true);
  assert.ok(codexHistory.entries.length >= 2);

  const claudeRef = sessionReference("claude", "claude-sess-1");
  const claudeHistory = await env.catalog.getGlobalHistory(claudeRef);
  assert.equal(claudeHistory.available, true);
  assert.ok(claudeHistory.entries.length >= 2);

  const coworkRef = sessionReference("cowork", "user-acct:org-1:local_cowork-1");
  const coworkHistory = await env.catalog.getGlobalHistory(coworkRef);
  assert.equal(coworkHistory.available, true);
  assert.ok(coworkHistory.entries.length >= 1);
});

test("unavailable transcript handling returns available: false and clean reason", async () => {
  const env = await createTestEnvironment();

  // Missing session reference
  const missingRef = sessionReference("codex", "non-existent-session-id");
  const history = await env.catalog.getGlobalHistory(missingRef);
  assert.equal(history.available, false);
  assert.equal(history.reason, "Local transcript unavailable.");
  assert.equal(history.entries.length, 0);
});

test("Antigravity and Gemini return unsupported capability result", async () => {
  const env = await createTestEnvironment();

  const agyRes = await env.catalog.listGlobalRecentSessions("antigravity", 50, env.knownProjects);
  assert.equal(agyRes.state, "unsupported");
  assert.equal(agyRes.items.length, 0);
  assert.match(agyRes.reason ?? "", /Antigravity sessions unsupported in V1/);

  const geminiRes = await env.catalog.listGlobalRecentSessions("gemini", 50, env.knownProjects);
  assert.equal(geminiRes.state, "unsupported");
  assert.equal(geminiRes.items.length, 0);
  assert.match(geminiRes.reason ?? "", /Gemini CLI sessions unsupported in V1/);
});

test("existing project-scoped getHistory continues to enforce checkout confinement", async () => {
  const env = await createTestEnvironment();

  // OpenCode session 2 is in externalFolder, not in projectAlpha
  const openCodeRef2 = sessionReference("opencode", "opencode-sess-2");
  await assert.rejects(
    async () => {
      await env.catalog.getHistory(env.projectAlpha, openCodeRef2);
    },
    /session is not associated with this checkout/
  );
});

test("SessionHistoryCatalog is aliased and instantiable", () => {
  const catalog = new SessionHistoryCatalog([]);
  assert.ok(catalog);
  assert.ok(catalog instanceof GuidanceHistoryCatalog);
});
