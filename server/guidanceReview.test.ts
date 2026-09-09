import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { GuidanceReview } from "../core/types.ts";
import { GuidanceReviewService } from "./guidanceReview.ts";
import { decodeSessionReference } from "./guidanceHistory/references.ts";

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "guidance-review-"));
  const checkout = resolve(root, "checkout");
  const source = resolve(root, "opencode.db");
  await mkdir(checkout);
  const db = new DatabaseSync(source);
  db.exec("CREATE TABLE session (id text PRIMARY KEY, title text, directory text, parent_id text, time_created integer, time_updated integer)");
  db.exec("CREATE TABLE message (id text PRIMARY KEY, session_id text, time_created integer, time_updated integer, data text)");
  db.exec("CREATE TABLE part (id text PRIMARY KEY, message_id text, session_id text, time_created integer, time_updated integer, data text)");
  const now = Date.now();
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?)").run("session-a", "Guidance fixture", checkout, null, now, now);
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("message-a", "session-a", now, now, JSON.stringify({ role: "user" }));
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run("part-a", "message-a", "session-a", now, now, JSON.stringify({ type: "text", text: "Please use the documented verification command." }));
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run("part-b", "message-a", "session-a", now + 1, now + 1, JSON.stringify({ type: "tool", tool: "bash", state: { status: "error", input: { command: "npm test" }, error: "command not found", output: "unused success body" } }));
  db.close();
  const service = new GuidanceReviewService(root, async () => ({ id: "project-a", path: checkout }), async () => ({ openCodeDatabasePath: source }));
  return { root, checkout, service };
}

async function multiSourceFixture() {
  const result = await fixture();
  const claudeRoot = resolve(result.root, "claude");
  const desktopRoot = resolve(result.root, "claude-desktop");
  const projectDir = resolve(claudeRoot, "projects", claudeProjectDirectoryName(await realpath(result.checkout)));
  await mkdir(projectDir, { recursive: true });
  const transcript = [
    { uuid: "claude-user", sessionId: "session-a", cwd: result.checkout, timestamp: "2026-09-07T09:00:00.000Z", message: { role: "user", content: "Run the focused verification." } },
    { uuid: "claude-tool", sessionId: "session-a", cwd: result.checkout, timestamp: "2026-09-07T09:01:00.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "tool-a", name: "Bash", input: { command: "npm test" } }] } },
    { uuid: "claude-result", sessionId: "session-a", cwd: result.checkout, timestamp: "2026-09-07T09:02:00.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-a", content: "tests passed", is_error: false }] } },
  ].map((record) => JSON.stringify(record)).join("\n");
  const transcriptPath = resolve(projectDir, "session-a.jsonl");
  await writeFile(transcriptPath, `${transcript}\n`, "utf8");
  await writeClaudeCache(projectDir, transcriptPath, "session-a");
  await mkdir(desktopRoot, { recursive: true });
  await writeFile(resolve(desktopRoot, "local-linked.json"), JSON.stringify({ cliSessionId: "session-a", cwd: result.checkout, title: "Desktop linked" }), "utf8");
  const service = new GuidanceReviewService(result.root, async () => ({ id: "project-a", path: result.checkout }), async () => ({ openCodeDatabasePath: resolve(result.root, "opencode.db"), claudeConfigDir: claudeRoot, claudeDesktopSessionsPath: desktopRoot }));
  return { ...result, service };
}

async function writeClaudeCache(projectDir: string, transcriptPath: string, sessionId: string) {
  await writeFile(resolve(projectDir, ".session_cache.json"), JSON.stringify({ version: 8, entries: { [transcriptPath]: { session: { session_id: sessionId, actual_session_id: sessionId, file_path: transcriptPath, summary: "Fixture session" } } } }), "utf8");
}

function claudeProjectDirectoryName(checkout: string): string {
  return `-${checkout.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-/, "")}`;
}

test("history pages preserve tool status while keeping successful output on demand", async () => {
  const { service } = await fixture();
  const info = await service.getReviewInfo("project-a");
  assert.equal(info.model, "gemini-3.8-flash");
  const sessionResult = await service.listSessions("project-a");
  const sessions = sessionResult.sessions;
  assert.equal(sessionResult.sources.find((source) => source.id === "opencode")?.state, "ready");
  assert.equal(sessions.length, 1);
  const page = await service.getHistory("project-a", sessions[0]!.id);
  assert.equal(page.entries.length, 2);
  const toolEntry = page.entries.find((entry) => entry.tool);
  assert.equal(toolEntry?.tool?.status, "error");
  assert.equal(toolEntry?.tool?.input, JSON.stringify({ command: "npm test" }));
  assert.equal(toolEntry?.tool?.error, "command not found");
  assert.equal(toolEntry?.tool?.outputAvailable, true);
  const output = await service.getToolPayload("project-a", toolEntry!.tool!.callRef, "output");
  assert.equal(output.content, "unused success body");
});

test("oversized inline tool fields stay retrievable without hiding failed status", async () => {
  const { root, service } = await fixture();
  const source = resolve(root, "opencode.db");
  const db = new DatabaseSync(source);
  const oversized = "x".repeat(2_049);
  const now = Date.now();
  db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run("part-large", "message-a", "session-a", now, now, JSON.stringify({ type: "tool", tool: "bash", state: { status: "error", input: oversized, error: oversized } }));
  db.close();
  const session = (await service.listSessions("project-a")).sessions[0]!;
  const page = await service.getHistory("project-a", session.id);
  const toolEntry = page.entries.find((entry) => entry.partId === "part-large");
  assert.equal(toolEntry?.tool?.status, "error");
  assert.equal(toolEntry?.tool?.inputOmitted, true);
  assert.equal(toolEntry?.tool?.errorOmitted, true);
  const payload = await service.getToolPayload("project-a", toolEntry!.tool!.callRef, "error");
  assert.equal(payload.available, true);
  assert.equal(payload.content, oversized);
});

test("source-qualified OpenCode and Claude sessions with equal native IDs remain isolated", async () => {
  const { service } = await multiSourceFixture();
  const result = await service.listSessions("project-a");
  assert.equal(result.sources.find((source) => source.id === "opencode")?.state, "ready");
  assert.equal(result.sources.find((source) => source.id === "claude")?.state, "ready");
  const claude = result.sessions.find((session) => session.sourceId === "claude" && session.available !== false)!;
  assert.notEqual(result.sessions.find((session) => session.sourceId === "opencode")!.id, claude.id);
  assert.equal(claude.client, "Claude Desktop Code");
  const history = await service.getHistory("project-a", claude.id);
  const tool = history.entries.find((entry) => entry.tool)!;
  assert.equal(tool.tool?.input, JSON.stringify({ command: "npm test" }));
  assert.equal((await service.getToolPayload("project-a", tool.tool!.callRef, "output")).content, "tests passed");
  const crossSourceCursor = Buffer.from(JSON.stringify({ sourceId: "opencode", nativeSessionId: "session-a", version: history.sourceVersion, offset: 0 }), "utf8").toString("base64url");
  await assert.rejects(service.getHistory("project-a", claude.id, crossSourceCursor), /cursor/);
});

test("Claude discovery maps a project cache to its sessions without transcript cwd metadata", async () => {
  const { root, checkout } = await fixture();
  const claudeRoot = resolve(root, "claude-after-setup");
  const projectDir = resolve(claudeRoot, "projects", claudeProjectDirectoryName(await realpath(checkout)));
  await mkdir(projectDir, { recursive: true });
  const transcript = [
    { type: "summary", sessionId: "claude-after-setup", timestamp: "2026-09-07T09:00:00.000Z" },
    { type: "user", uuid: "claude-user", sessionId: "claude-after-setup", cwd: checkout, timestamp: "2026-09-07T09:00:01.000Z", message: { role: "user", content: "Use the checkout guidance." } },
  ].map((record) => JSON.stringify(record)).join("\n");
  const transcriptPath = resolve(projectDir, "claude-after-setup.jsonl");
  await writeFile(transcriptPath, `${transcript}\n`, "utf8");
  await writeClaudeCache(projectDir, transcriptPath, "claude-after-setup");
  const service = new GuidanceReviewService(root, async () => ({ id: "project-a", path: checkout }), async () => ({ claudeConfigDir: claudeRoot, guidanceHistorySources: ["claude"] }));
  const sessions = (await service.listSessions("project-a")).sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.client, "Claude Code");
});

test("approved edits preserve unrelated guidance and apply only the selected subset", async () => {
  const { root, checkout, service } = await fixture();
  const target = resolve(checkout, "AGENTS.md");
  await writeFile(target, "keep this\nold one\nold two\n", "utf8");
  const now = new Date().toISOString();
  const review: GuidanceReview = {
    id: randomUUID(), projectId: "project-a", checkout, targetPath: target, targetExisted: true,
    initialGuidance: "keep this\nold one\nold two\n", selectedSessionIds: ["session-a"], sourceVersions: {}, model: "test",
    status: "completed", createdAt: now, updatedAt: now, progress: "ready", edits: [
      { id: "one", operation: "replace", oldText: "old one", newText: "new one", title: "First", rationale: "r", category: "pointer", usefulness: "u", evidence: [{ sessionId: "session-a", entryId: "session-a:part-a" }] },
      { id: "two", operation: "replace", oldText: "old two", newText: "new two", title: "Second", rationale: "r", category: "pointer", usefulness: "u", evidence: [{ sessionId: "session-a", entryId: "session-a:part-a" }] },
    ], decisions: {}, evidence: {},
  };
  await mkdir(resolve(root, "data"));
  await writeFile(resolve(root, "data/guidance-reviews.json"), JSON.stringify({ version: 1, reviews: [review] }), "utf8");
  const applied = await service.applyEdits(review.id, ["one"]);
  assert.equal(applied.status, "applied");
  assert.equal(await readFile(target, "utf8"), "keep this\nnew one\nold two\n");
});

test("an interrupted verified write is reconciled without appending the edit twice", async () => {
  const { root, checkout, service } = await fixture();
  const target = resolve(checkout, "AGENTS.md");
  const original = "old guidance\n";
  const written = "new guidance\n";
  await writeFile(target, written, "utf8");
  const now = new Date().toISOString();
  const review: GuidanceReview = {
    id: randomUUID(), projectId: "project-a", checkout, targetPath: target, targetExisted: true, initialGuidance: original,
    selectedSessionIds: ["session-a"], sourceVersions: {}, model: "test", status: "applying", createdAt: now, updatedAt: now,
    progress: "Writing selected guidance edits", edits: [{ id: "edit", operation: "replace", oldText: "old guidance", newText: "new guidance", title: "Update", rationale: "r", category: "pointer", usefulness: "u", evidence: [{ sessionId: "session-a", entryId: "session-a:part-a" }] }],
    decisions: { edit: "selected" }, evidence: {}, writeIntent: { editIds: ["edit"], contentHash: createHash("sha256").update(written).digest("hex") },
  };
  await mkdir(resolve(root, "data"));
  await writeFile(resolve(root, "data/guidance-reviews.json"), JSON.stringify({ version: 1, reviews: [review] }), "utf8");
  const reconciled = await service.applyEdits(review.id, ["edit"]);
  assert.equal(reconciled.status, "applied");
  assert.equal(await readFile(target, "utf8"), written);
});

async function coworkFixture() {
  const result = await multiSourceFixture();
  const coworkRoot = resolve(result.root, "claude-cowork");
  const account1 = "acc-1";
  const org1 = "org-1";
  const orgDir1 = resolve(coworkRoot, account1, org1);
  await mkdir(orgDir1, { recursive: true });

  const canonicalCheckout = await realpath(result.checkout);

  // 1. Exact match session
  const meta1 = {
    sessionId: "local_cowork_1",
    cliSessionId: "cli-cowork-1",
    title: "Exact Cowork Session",
    userSelectedFolders: [canonicalCheckout],
    cwd: resolve(orgDir1, "local_cowork_1/outputs"),
    createdAt: 1780000000000,
    lastActivityAt: 1780000010000,
  };
  await writeFile(resolve(orgDir1, "local_cowork_1.json"), JSON.stringify(meta1), "utf8");
  const transcriptDir1 = resolve(orgDir1, "local_cowork_1/.claude/projects/-workspace");
  await mkdir(transcriptDir1, { recursive: true });
  const transcript1 = [
    { uuid: "u1", sessionId: "cli-cowork-1", timestamp: "2026-09-07T10:00:00.000Z", message: { role: "user", content: "Run verification" } },
    { uuid: "a1", sessionId: "cli-cowork-1", timestamp: "2026-09-07T10:00:01.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "Bash", input: { command: "npm test" } }] } },
    { uuid: "u2", sessionId: "cli-cowork-1", timestamp: "2026-09-07T10:00:02.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "tests passed", is_error: false }] } },
    { uuid: "a2", sessionId: "cli-cowork-1", timestamp: "2026-09-07T10:00:03.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "call-2", name: "Bash", input: { command: "npm run deploy" } }] } },
    { uuid: "u3", sessionId: "cli-cowork-1", timestamp: "2026-09-07T10:00:04.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call-2", content: "deployment error", is_error: true }] } },
    { uuid: "meta-1", sessionId: "cli-cowork-1", isMeta: true, timestamp: "2026-09-07T10:00:05.000Z", message: { role: "user", content: "Injected task prompt" } },
    { uuid: "att-1", sessionId: "cli-cowork-1", type: "attachment", timestamp: "2026-09-07T10:00:06.000Z", attachment: { type: "task_reminder" } },
  ].map((r) => JSON.stringify(r)).join("\n");
  await writeFile(resolve(transcriptDir1, "cli-cowork-1.jsonl"), `${transcript1}\n`, "utf8");

  // 2. Multi-folder session including checkout
  const otherDir = resolve(result.root, "other-folder");
  await mkdir(otherDir);
  const metaMulti = {
    sessionId: "local_cowork_multi",
    cliSessionId: "cli-cowork-multi",
    title: "Multi Folder Session",
    userSelectedFolders: [canonicalCheckout, await realpath(otherDir)],
  };
  await writeFile(resolve(orgDir1, "local_cowork_multi.json"), JSON.stringify(metaMulti), "utf8");

  // 3. Ancestor folder session
  const metaAncestor = {
    sessionId: "local_cowork_ancestor",
    cliSessionId: "cli-cowork-ancestor",
    title: "Ancestor Session",
    userSelectedFolders: [await realpath(result.root)],
  };
  await writeFile(resolve(orgDir1, "local_cowork_ancestor.json"), JSON.stringify(metaAncestor), "utf8");

  // 4. Unrelated folder session
  const metaUnrelated = {
    sessionId: "local_cowork_unrelated",
    cliSessionId: "cli-cowork-unrelated",
    title: "Unrelated Session",
    userSelectedFolders: [await realpath(otherDir)],
  };
  await writeFile(resolve(orgDir1, "local_cowork_unrelated.json"), JSON.stringify(metaUnrelated), "utf8");

  // 5. No folder session
  const metaNoFolder = {
    sessionId: "local_cowork_nofolder",
    cliSessionId: "cli-cowork-nofolder",
    title: "No Folder Session",
    userSelectedFolders: [],
  };
  await writeFile(resolve(orgDir1, "local_cowork_nofolder.json"), JSON.stringify(metaNoFolder), "utf8");

  // 6. Duplicate session ID in account 2
  const account2 = "acc-2";
  const org2 = "org-2";
  const orgDir2 = resolve(coworkRoot, account2, org2);
  await mkdir(orgDir2, { recursive: true });
  const metaDup = {
    sessionId: "local_cowork_1",
    cliSessionId: "cli-cowork-dup",
    title: "Duplicate ID in Account 2",
    userSelectedFolders: [canonicalCheckout],
  };
  await writeFile(resolve(orgDir2, "local_cowork_1.json"), JSON.stringify(metaDup), "utf8");
  const transcriptDirDup = resolve(orgDir2, "local_cowork_1/.claude/projects/-workspace");
  await mkdir(transcriptDirDup, { recursive: true });
  const transcriptDup = [
    { uuid: "dup-u1", sessionId: "cli-cowork-dup", timestamp: "2026-09-07T11:00:00.000Z", message: { role: "user", content: "Account 2 session content" } },
  ].map((r) => JSON.stringify(r)).join("\n");
  await writeFile(resolve(transcriptDirDup, "cli-cowork-dup.jsonl"), `${transcriptDup}\n`, "utf8");

  // 7. Missing transcript
  const metaMissing = {
    sessionId: "local_cowork_missing_transcript",
    cliSessionId: "cli-cowork-missing",
    title: "Missing Transcript Session",
    userSelectedFolders: [canonicalCheckout],
  };
  await writeFile(resolve(orgDir1, "local_cowork_missing_transcript.json"), JSON.stringify(metaMissing), "utf8");

  // 8. Mismatched transcript
  const metaMismatch = {
    sessionId: "local_cowork_mismatch",
    cliSessionId: "cli-cowork-expected",
    title: "Mismatched Transcript Session",
    userSelectedFolders: [canonicalCheckout],
  };
  await writeFile(resolve(orgDir1, "local_cowork_mismatch.json"), JSON.stringify(metaMismatch), "utf8");
  const transcriptDirMismatch = resolve(orgDir1, "local_cowork_mismatch/.claude/projects/-workspace");
  await mkdir(transcriptDirMismatch, { recursive: true });
  const transcriptMismatch = [
    { uuid: "mis-u1", sessionId: "cli-cowork-different-id", timestamp: "2026-09-07T12:00:00.000Z", message: { role: "user", content: "Different ID" } },
  ].map((r) => JSON.stringify(r)).join("\n");
  await writeFile(resolve(transcriptDirMismatch, "cli-cowork-expected.jsonl"), `${transcriptMismatch}\n`, "utf8");

  const service = new GuidanceReviewService(
    result.root,
    async () => ({ id: "project-a", path: result.checkout }),
    async () => ({
      openCodeDatabasePath: resolve(result.root, "opencode.db"),
      claudeConfigDir: resolve(result.root, "claude"),
      claudeDesktopSessionsPath: resolve(result.root, "claude-desktop"),
      claudeCoworkSessionsPath: coworkRoot,
    }),
  );

  return { ...result, coworkRoot, orgDir1, orgDir2, service };
}

test("Cowork adapter discovers exact single-folder sessions and isolates cross-source credentials", async () => {
  const { service } = await coworkFixture();
  const result = await service.listSessions("project-a");
  assert.equal(result.sources.find((s) => s.id === "cowork")?.state, "ready");

  const exact = result.sessions.find((s) => s.title === "Exact Cowork Session");
  assert.ok(exact);
  assert.equal(exact?.client, "Claude Cowork (local)");
  assert.equal(exact?.available, true);

  const history = await service.getHistory("project-a", exact!.id);
  assert.equal(history.entries.length, 5);

  // Successful tool
  const tool1 = history.entries.find((e) => e.tool?.name === "Bash" && e.tool?.status === "success");
  assert.equal(tool1?.tool?.status, "success");
  assert.equal(tool1?.tool?.outputAvailable, true);
  const out1 = await service.getToolPayload("project-a", tool1!.tool!.callRef, "output");
  assert.equal(out1.content, "tests passed");

  // Failed tool
  const tool2 = history.entries.find((e) => e.tool?.name === "Bash" && e.tool?.status === "error");
  assert.equal(tool2?.tool?.status, "error");
  assert.equal(tool2?.tool?.error, "deployment error");
  const err2 = await service.getToolPayload("project-a", tool2!.tool!.callRef, "error");
  assert.equal(err2.content, "deployment error");

  // Meta record is not presented as user correction
  const metaEntry = history.entries.find((e) => e.type === "meta");
  assert.ok(metaEntry);
  assert.notEqual(metaEntry?.role, "user");
  assert.equal(metaEntry?.type, "meta");

  // Attachment record is unavailable
  const attEntry = history.entries.find((e) => e.type === "attachment");
  assert.ok(attEntry);
  assert.equal(attEntry?.type, "attachment");
  assert.equal(attEntry?.unavailable, "attachment content is not review evidence");
});

test("Cowork project association excludes multi-folder, ancestor-folder, and unrelated sessions", async () => {
  const { service } = await coworkFixture();
  const result = await service.listSessions("project-a");

  // Multi-folder session with checkout: disabled with explicit reason
  const multi = result.sessions.find((s) => s.title === "Multi Folder Session");
  assert.ok(multi);
  assert.equal(multi?.available, false);
  assert.equal(multi?.unavailableReason, "Multi-folder Cowork sessions are excluded from automatic project association.");

  // Ancestor folder session: disabled with explicit reason
  const ancestor = result.sessions.find((s) => s.title === "Ancestor Session");
  assert.ok(ancestor);
  assert.equal(ancestor?.available, false);
  assert.equal(ancestor?.unavailableReason, "Ancestor-folder Cowork sessions are excluded from automatic project association.");

  // Unrelated and no-folder sessions: not listed at all
  assert.equal(result.sessions.find((s) => s.title === "Unrelated Session"), undefined);
  assert.equal(result.sessions.find((s) => s.title === "No Folder Session"), undefined);
});

test("Cowork avoids ID collisions across accounts and marks missing/mismatched transcripts unavailable", async () => {
  const { service } = await coworkFixture();
  const result = await service.listSessions("project-a");

  const exact = result.sessions.find((s) => s.title === "Exact Cowork Session")!;
  const dup = result.sessions.find((s) => s.title === "Duplicate ID in Account 2")!;
  assert.ok(exact && dup);
  assert.notEqual(exact.id, dup.id);

  // Missing transcript
  const missing = result.sessions.find((s) => s.title === "Missing Transcript Session")!;
  assert.ok(missing);
  assert.equal(missing.available, false);
  assert.equal(missing.unavailableReason, "Local transcript unavailable.");

  // Mismatched transcript
  const mismatch = result.sessions.find((s) => s.title === "Mismatched Transcript Session")!;
  assert.ok(mismatch);
  assert.equal(mismatch.available, false);
  assert.equal(mismatch.unavailableReason, "Transcript record session ID does not match metadata.");
});

test("Cowork composite version hash changes upon metadata or transcript mutation", async () => {
  const { service, orgDir1, checkout } = await coworkFixture();
  const result = await service.listSessions("project-a");
  const exact = result.sessions.find((s) => s.title === "Exact Cowork Session")!;

  const version1 = await service.getHistory("project-a", exact.id);

  // 1. Mutate metadata (selected folders)
  const metaPath = resolve(orgDir1, "local_cowork_1.json");
  const metaContent = JSON.parse(await readFile(metaPath, "utf8"));
  const otherFolder = resolve(checkout, "../other-folder");
  await writeFile(metaPath, JSON.stringify({ ...metaContent, userSelectedFolders: [checkout, otherFolder] }), "utf8");

  // Calling getHistory or getSessionVersion should now reject because folders changed (no longer single exact match)
  await assert.rejects(service.getHistory("project-a", exact.id), /excluded/);

  // Restore valid single folder with modified title/cwd
  await writeFile(metaPath, JSON.stringify({ ...metaContent, cwd: "/different/cwd" }), "utf8");
  const version2 = (await service.getHistory("project-a", exact.id)).sourceVersion;
  assert.notEqual(version1.sourceVersion, version2);

  // 2. Mutate transcript
  const transcriptPath = resolve(orgDir1, "local_cowork_1/.claude/projects/-workspace/cli-cowork-1.jsonl");
  const extraLine = JSON.stringify({ uuid: "u-extra", sessionId: "cli-cowork-1", timestamp: "2026-09-07T13:00:00.000Z", message: { role: "user", content: "Extra message" } });
  await writeFile(transcriptPath, `${await readFile(transcriptPath, "utf8")}${extraLine}\n`, "utf8");
  const version3 = (await service.getHistory("project-a", exact.id)).sourceVersion;
  assert.notEqual(version2, version3);
});

test("Cowork rejects cross-source cursors and exposes partial transcript tails", async () => {
  const { service, orgDir1, checkout } = await coworkFixture();
  const result = await service.listSessions("project-a");
  const exact = result.sessions.find((s) => s.title === "Exact Cowork Session")!;
  const history = await service.getHistory("project-a", exact.id);

  // Cross-source cursor with sourceId: "claude"
  const fakeCursor = Buffer.from(JSON.stringify({ sourceId: "claude", nativeSessionId: "cli-cowork-1", version: history.sourceVersion, offset: 0 }), "utf8").toString("base64url");
  await assert.rejects(service.getHistory("project-a", exact.id, fakeCursor), /cursor/);

  // Partial tail: unterminated line
  const partialSessionMeta = {
    sessionId: "local_cowork_partial",
    cliSessionId: "cli-cowork-partial",
    title: "Partial Tail Session",
    userSelectedFolders: [await realpath(checkout)],
  };
  await writeFile(resolve(orgDir1, "local_cowork_partial.json"), JSON.stringify(partialSessionMeta), "utf8");
  const partialTranscriptDir = resolve(orgDir1, "local_cowork_partial/.claude/projects/-workspace");
  await mkdir(partialTranscriptDir, { recursive: true });
  const validPart = JSON.stringify({ uuid: "part-u1", sessionId: "cli-cowork-partial", timestamp: "2026-09-07T14:00:00.000Z", message: { role: "user", content: "Valid line" } });
  const unterminatedTail = '{"uuid": "part-u2", "sessionId": "cli-cowork-partial"'; // no newline, cut off
  await writeFile(resolve(partialTranscriptDir, "cli-cowork-partial.jsonl"), `${validPart}\n${unterminatedTail}`, "utf8");

  const partialSession = (await service.listSessions("project-a")).sessions.find((s) => s.title === "Partial Tail Session")!;
  const partialHistory = await service.getHistory("project-a", partialSession.id);
  assert.equal(partialHistory.incomplete, "An unterminated transcript tail was omitted.");
});

test("mixed-source review enforces session availability and validates Cowork citations", async () => {
  const { root, checkout, service } = await coworkFixture();
  const sessionResult = await service.listSessions("project-a");

  const opencode = sessionResult.sessions.find((s) => s.sourceId === "opencode")!;
  const claude = sessionResult.sessions.find((s) => s.sourceId === "claude" && s.available !== false)!;
  const cowork = sessionResult.sessions.find((s) => s.sourceId === "cowork" && s.available !== false)!;
  const multi = sessionResult.sessions.find((s) => s.title === "Multi Folder Session")!;

  assert.ok(opencode && claude && cowork && multi);

  // 1. Including an unavailable Cowork session fails startReview
  await assert.rejects(
    service.startReview("project-a", [opencode.id, multi.id]),
    /Multi-folder Cowork sessions are excluded from automatic project association./,
  );

  // 2. Persist a mixed-source completed review with citations across sources
  const target = resolve(checkout, "AGENTS.md");
  await writeFile(target, "original guidance content\n", "utf8");
  const coworkHistory = await service.getHistory("project-a", cowork.id);
  const coworkEntry = coworkHistory.entries.find((e) => e.tool?.status === "success")!;

  const now = new Date().toISOString();
  const review: GuidanceReview = {
    id: randomUUID(),
    projectId: "project-a",
    checkout,
    targetPath: target,
    targetExisted: true,
    initialGuidance: "original guidance content\n",
    selectedSessionIds: [opencode.id, claude.id, cowork.id],
    sourceVersions: {
      [cowork.id]: coworkHistory.sourceVersion,
    },
    historyReferenceVersion: 1,
    selectedSessionManifest: [
      { id: opencode.id, sourceId: "opencode", nativeSessionId: "session-a", client: "OpenCode", title: "OpenCode session", decoderVersion: "opencode-sqlite-v1" },
      { id: claude.id, sourceId: "claude", nativeSessionId: "session-a", client: "Claude Desktop Code", title: "Claude session", decoderVersion: "claude-jsonl-v1" },
      { id: cowork.id, sourceId: "cowork", nativeSessionId: "acc-1:org-1:local_cowork_1", client: "Claude Cowork (local)", title: "Exact Cowork Session", decoderVersion: "claude-cowork-v1" },
    ],
    model: "test-model",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    progress: "ready",
    edits: [
      {
        id: "edit-cowork",
        operation: "replace",
        oldText: "original guidance content\n",
        newText: "updated guidance with cowork evidence\n",
        title: "Cowork guidance edit",
        rationale: "r",
        category: "process",
        usefulness: "high",
        evidence: [
          { sessionId: cowork.id, entryId: coworkEntry.id },
          { sessionId: cowork.id, callRef: coworkEntry.tool!.callRef, section: "output" },
        ],
      },
    ],
    decisions: { "edit-cowork": "selected" },
    evidence: {},
  };

  await mkdir(resolve(root, "data"), { recursive: true });
  await writeFile(resolve(root, "data/guidance-reviews.json"), JSON.stringify({ version: 1, reviews: [review] }), "utf8");

  const applied = await service.applyEdits(review.id, ["edit-cowork"]);
  assert.equal(applied.status, "applied");
  assert.equal(await readFile(target, "utf8"), "updated guidance with cowork evidence\n");
});

test("guidance review reflects Bedrock provider and validates Bedrock API key", async () => {
  const { root, checkout } = await fixture();
  const source = resolve(root, "opencode.db");

  // Service with Bedrock provider but no key
  const serviceNoKey = new GuidanceReviewService(
    root,
    async () => ({ id: "project-a", path: checkout }),
    async () => ({
      openCodeDatabasePath: source,
      guidanceReviewProvider: "bedrock",
      guidanceReviewModel: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    }),
  );

  const infoNoKey = await serviceNoKey.getReviewInfo("project-a");
  assert.equal(infoNoKey.provider, "bedrock");
  assert.equal(infoNoKey.model, "anthropic.claude-3-5-sonnet-20241022-v2:0");
  assert.equal(infoNoKey.hasProviderCredentials, false);

  await assert.rejects(
    async () => serviceNoKey.startReview("project-a", ["opencode:session-a"]),
    /Amazon Bedrock API key is not configured/,
  );

  // Service with Bedrock provider and key
  const serviceWithKey = new GuidanceReviewService(
    root,
    async () => ({ id: "project-a", path: checkout }),
    async () => ({
      openCodeDatabasePath: source,
      guidanceReviewProvider: "bedrock",
      guidanceReviewModel: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      bedrockApiKey: "test-bedrock-bearer-token",
    }),
  );

  const infoWithKey = await serviceWithKey.getReviewInfo("project-a");
  assert.equal(infoWithKey.provider, "bedrock");
  assert.equal(infoWithKey.hasProviderCredentials, true);
});

async function codexFixture() {
  const result = await multiSourceFixture();
  const codexRoot = resolve(result.root, "codex");
  const sessionsDir = resolve(codexRoot, "sessions");
  const archivedDir = resolve(codexRoot, "archived_sessions");
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(archivedDir, { recursive: true });

  const canonicalCheckout = await realpath(result.checkout);

  // 1. Valid active session rollout
  const activeRollout = [
    { type: "session_meta", payload: { id: "codex-active-1", cwd: canonicalCheckout, timestamp: "2026-09-07T10:00:00.000Z", history_mode: "rollout" } },
    { type: "response_item", payload: { type: "message", role: "developer", content: "system prompt configuration dump" } },
    { type: "event_msg", payload: { type: "user_message", content: "duplicate event message that should not be emitted" } },
    { type: "response_item", payload: { id: "msg-user-1", type: "message", role: "user", content: "Run tests and verify build." } },
    { type: "response_item", payload: { id: "msg-asst-1", type: "message", role: "assistant", phase: "final_answer", content: "I will run the command." } },
    { type: "response_item", payload: { id: "fc-1", type: "function_call", call_id: "call-1", name: "exec", arguments: { cmd: "npm test" } } },
    { type: "response_item", payload: { id: "fco-1", type: "function_call_output", call_id: "call-1", output: { exit_code: 0, stdout: "all tests passed with no error" } } },
    { type: "response_item", payload: { id: "fc-2", type: "function_call", call_id: "call-2", name: "exec", arguments: { cmd: "npm run lint" } } },
    { type: "response_item", payload: { id: "fco-2", type: "function_call_output", call_id: "call-2", output: { exit_code: 1, stderr: "lint failed: syntax error" } } },
    { type: "response_item", payload: { id: "custom-1", type: "custom_tool_call", call_id: "call-3", name: "custom_query", input: "SELECT * FROM items;" } },
    { type: "response_item", payload: { id: "custom-out-1", type: "custom_tool_call_output", call_id: "call-3", output: "row1, row2" } },
    { type: "response_item", payload: { id: "reason-1", type: "reasoning", encrypted: true } },
    { type: "response_item", payload: { id: "reason-2", type: "reasoning", text: "Visible reasoning explanation." } },
    { type: "compaction" },
  ].map((r) => JSON.stringify(r)).join("\n");
  await writeFile(resolve(sessionsDir, "codex-active-1.jsonl"), `${activeRollout}\n`, "utf8");

  // 2. Archived session rollout
  const archivedRollout = [
    { type: "session_meta", payload: { id: "codex-archived-1", cwd: canonicalCheckout, timestamp: "2026-09-07T08:00:00.000Z" } },
    { type: "response_item", payload: { id: "archived-user", type: "message", role: "user", content: "Archived task" } },
  ].map((r) => JSON.stringify(r)).join("\n");
  await writeFile(resolve(archivedDir, "codex-archived-1.jsonl"), `${archivedRollout}\n`, "utf8");

  // 3. Unrelated checkout rollout (different cwd)
  const unrelatedDir = resolve(result.root, "unrelated-dir");
  await mkdir(unrelatedDir, { recursive: true });
  const unrelatedRollout = [
    { type: "session_meta", payload: { id: "codex-unrelated", cwd: unrelatedDir, timestamp: "2026-09-07T07:00:00.000Z" } },
    { type: "response_item", payload: { id: "unrelated-user", type: "message", role: "user", content: "Unrelated task" } },
  ].map((r) => JSON.stringify(r)).join("\n");
  await writeFile(resolve(sessionsDir, "codex-unrelated.jsonl"), `${unrelatedRollout}\n`, "utf8");

  // 4. State SQLite database for title enrichment
  const stateDbPath = resolve(codexRoot, "state_5.sqlite");
  const stateDb = new DatabaseSync(stateDbPath);
  stateDb.exec("CREATE TABLE threads (id text PRIMARY KEY, rollout_path text, cwd text, title text, name text, created_at integer, updated_at integer, archived integer, history_mode text)");
  stateDb.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "codex-active-1",
    resolve(sessionsDir, "codex-active-1.jsonl"),
    canonicalCheckout,
    "Enriched Codex Active Session",
    "codex-active-1",
    new Date("2026-09-07T10:00:00.000Z").getTime() / 1000,
    new Date("2026-09-07T10:30:00.000Z").getTime() / 1000,
    0,
    "rollout",
  );
  stateDb.close();

  const service = new GuidanceReviewService(
    result.root,
    async () => ({ id: "project-a", path: result.checkout }),
    async () => ({
      openCodeDatabasePath: resolve(result.root, "opencode.db"),
      claudeConfigDir: resolve(result.root, "claude"),
      claudeDesktopSessionsPath: resolve(result.root, "claude-desktop"),
      codexHome: codexRoot,
    }),
  );

  return { ...result, codexRoot, sessionsDir, archivedDir, service };
}

test("Codex rollout history discovery matches cwd, enriches title from state_5.sqlite, and includes archived sessions", async () => {
  const { service } = await codexFixture();
  const result = await service.listSessions("project-a");
  assert.equal(result.sources.find((s) => s.id === "codex")?.state, "ready");

  const active = result.sessions.find((s) => s.title === "Enriched Codex Active Session");
  assert.ok(active);
  assert.equal(active?.client, "Codex");
  assert.equal(active?.available, true);
  assert.equal(active?.createdAt, "2026-09-07T10:00:00.000Z");
  assert.equal(active?.updatedAt, "2026-09-07T10:30:00.000Z");

  const archived = result.sessions.find((s) => {
    try {
      return decodeSessionReference(s.id).nativeSessionId === "codex-archived-1";
    } catch {
      return false;
    }
  });
  assert.ok(archived);
  assert.equal(archived?.title, "Untitled Codex session");

  const unrelated = result.sessions.find((s) => {
    try {
      return decodeSessionReference(s.id).nativeSessionId === "codex-unrelated";
    } catch {
      return false;
    }
  });
  assert.equal(unrelated, undefined);
});

test("Codex normalizes messages, handles custom tools, avoids string matching for failures, and pairs tool payloads", async () => {
  const { service } = await codexFixture();
  const result = await service.listSessions("project-a");
  const active = result.sessions.find((s) => s.title === "Enriched Codex Active Session")!;

  const history = await service.getHistory("project-a", active.id);

  // 1. Developer configuration dump is omitted from user/assistant role
  const devEntry = history.entries.find((e) => e.type === "developer");
  assert.ok(devEntry);
  assert.equal(devEntry?.role, undefined);
  assert.equal(devEntry?.unavailable, "developer configuration dump is not review evidence");

  // 2. User & assistant message with phase
  const userMsg = history.entries.find((e) => e.role === "user" && e.text === "Run tests and verify build.");
  assert.ok(userMsg);
  const asstMsg = history.entries.find((e) => e.role === "assistant" && e.type === "message:final_answer");
  assert.ok(asstMsg);

  // 3. Tool with exit_code 0 is successful even when output mentions 'error'
  const tool1 = history.entries.find((e) => e.tool?.name === "exec" && e.tool?.input?.includes("npm test"));
  assert.ok(tool1);
  assert.equal(tool1?.tool?.status, "success");
  assert.equal(tool1?.tool?.outputAvailable, true);
  const out1 = await service.getToolPayload("project-a", tool1!.tool!.callRef, "output");
  assert.ok(out1.content?.includes("all tests passed with no error"));

  // 4. Tool with exit_code 1 is error
  const tool2 = history.entries.find((e) => e.tool?.name === "exec" && e.tool?.input?.includes("npm run lint"));
  assert.ok(tool2);
  assert.equal(tool2?.tool?.status, "error");
  assert.equal(tool2?.tool?.outputAvailable, false);
  const err2 = await service.getToolPayload("project-a", tool2!.tool!.callRef, "error");
  assert.ok(err2.content?.includes("lint failed: syntax error"));

  // 5. Custom tool call with freeform input
  const tool3 = history.entries.find((e) => e.tool?.name === "custom_query");
  assert.ok(tool3);
  assert.equal(tool3?.tool?.input, "SELECT * FROM items;");
  const out3 = await service.getToolPayload("project-a", tool3!.tool!.callRef, "output");
  assert.equal(out3.content, "row1, row2");

  // 6. Reasoning: encrypted vs visible
  const encryptedReason = history.entries.find((e) => e.type === "reasoning" && e.unavailable === "Encrypted reasoning is unavailable.");
  assert.ok(encryptedReason);
  const visibleReason = history.entries.find((e) => e.type === "reasoning" && e.text === "Visible reasoning explanation.");
  assert.ok(visibleReason);

  // 7. Compaction
  const compactionEntry = history.entries.find((e) => e.type === "compaction");
  assert.ok(compactionEntry);
  assert.equal(compactionEntry?.unavailable, "pre-compaction content is unavailable");
});

test("Codex rejects cross-source cursors and invalidates version on rollout mutation", async () => {
  const { service, sessionsDir } = await codexFixture();
  const result = await service.listSessions("project-a");
  const active = result.sessions.find((s) => s.title === "Enriched Codex Active Session")!;

  const history = await service.getHistory("project-a", active.id);
  const version1 = history.sourceVersion;

  // Cross-source cursor with sourceId: 'claude'
  const fakeCursor = Buffer.from(
    JSON.stringify({ sourceId: "claude", nativeSessionId: "codex-active-1", version: version1, offset: 0 }),
    "utf8",
  ).toString("base64url");
  await assert.rejects(service.getHistory("project-a", active.id, fakeCursor), /cursor/);

  // Mutate rollout file
  const filePath = resolve(sessionsDir, "codex-active-1.jsonl");
  const extraLine = JSON.stringify({
    type: "response_item",
    payload: { id: "extra-msg", type: "message", role: "user", content: "Extra turn" },
  });
  await writeFile(filePath, `${await readFile(filePath, "utf8")}${extraLine}\n`, "utf8");

  const version2 = (await service.getHistory("project-a", active.id)).sourceVersion;
  assert.notEqual(version1, version2);
});

test("Codex projected history reads thread_items when projection watermark matches rollout", async () => {
  const { codexRoot, sessionsDir, service } = await codexFixture();
  const rolloutPath = resolve(sessionsDir, "codex-active-1.jsonl");
  const rolloutStat = await stat(rolloutPath);

  // Create thread_history_1.sqlite with matching watermark
  const historyDbPath = resolve(codexRoot, "thread_history_1.sqlite");
  const historyDb = new DatabaseSync(historyDbPath);
  historyDb.exec("CREATE TABLE thread_history_projection_state (thread_id text PRIMARY KEY, next_rollout_byte_offset integer)");
  historyDb.exec("CREATE TABLE thread_items (item_id text PRIMARY KEY, thread_id text, item_type text, item_json text, rollout_ordinal integer, created_at_ms integer)");

  historyDb.prepare("INSERT INTO thread_history_projection_state VALUES (?, ?)").run("codex-active-1", rolloutStat.size);
  const now = Date.now();
  historyDb.prepare("INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?)").run(
    "proj-1",
    "codex-active-1",
    "userMessage",
    JSON.stringify({ content: "Projected user message" }),
    1,
    now,
  );
  historyDb.prepare("INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?)").run(
    "proj-2",
    "codex-active-1",
    "commandExecution",
    JSON.stringify({ command: "echo hello", aggregatedOutput: "hello\n", exitCode: 0, status: "completed" }),
    2,
    now + 10,
  );
  historyDb.close();

  const active = (await service.listSessions("project-a")).sessions.find((s) => s.title === "Enriched Codex Active Session")!;
  const history = await service.getHistory("project-a", active.id);

  const userEntry = history.entries.find((e) => e.text === "Projected user message");
  assert.ok(userEntry);

  const cmdEntry = history.entries.find((e) => e.tool?.name === "bash");
  assert.ok(cmdEntry);
  assert.equal(cmdEntry?.tool?.status, "success");
  assert.equal(cmdEntry?.tool?.input, "echo hello");

  const payload = await service.getToolPayload("project-a", cmdEntry!.tool!.callRef, "output");
  assert.equal(payload.content, "hello\n");
});

test("sessions are ordered solely by timestamp with latest first across all providers", async () => {
  const { service } = await codexFixture();
  const result = await service.listSessions("project-a");

  assert.ok(result.sessions.length >= 3);
  // Verify that every session has timestamp >= the next session's timestamp
  for (let i = 0; i < result.sessions.length - 1; i++) {
    const current = new Date(result.sessions[i]!.updatedAt ?? result.sessions[i]!.createdAt ?? 0).getTime();
    const next = new Date(result.sessions[i + 1]!.updatedAt ?? result.sessions[i + 1]!.createdAt ?? 0).getTime();
    assert.ok(current >= next, `Expected session ${i} (${result.sessions[i]!.title}) timestamp ${current} to be >= session ${i + 1} (${result.sessions[i + 1]!.title}) timestamp ${next}`);
  }

  // Verify that sessions from different providers interleave by timestamp rather than being grouped
  const sourceIds = result.sessions.map((s) => s.sourceId);
  const distinctSources = new Set(sourceIds);
  assert.ok(distinctSources.size >= 2);
});

test("mixed-source review with Codex sessions validates citations and applies edits", async () => {
  const { root, checkout, service } = await codexFixture();
  const sessionResult = await service.listSessions("project-a");

  const opencode = sessionResult.sessions.find((s) => s.sourceId === "opencode")!;
  const claude = sessionResult.sessions.find((s) => s.sourceId === "claude" && s.available !== false)!;
  const codex = sessionResult.sessions.find((s) => s.sourceId === "codex" && s.available !== false)!;

  assert.ok(opencode && claude && codex);

  const target = resolve(checkout, "AGENTS.md");
  await writeFile(target, "initial guidance before codex review\n", "utf8");

  const codexHistory = await service.getHistory("project-a", codex.id);
  const codexEntry = codexHistory.entries.find((e) => e.tool?.status === "success")!;

  const now = new Date().toISOString();
  const review: GuidanceReview = {
    id: randomUUID(),
    projectId: "project-a",
    checkout,
    targetPath: target,
    targetExisted: true,
    initialGuidance: "initial guidance before codex review\n",
    selectedSessionIds: [opencode.id, claude.id, codex.id],
    sourceVersions: {
      [codex.id]: codexHistory.sourceVersion,
    },
    historyReferenceVersion: 1,
    selectedSessionManifest: [
      { id: opencode.id, sourceId: "opencode", nativeSessionId: "session-a", client: "OpenCode", title: "OpenCode session", decoderVersion: "opencode-sqlite-v1" },
      { id: claude.id, sourceId: "claude", nativeSessionId: "session-a", client: "Claude Desktop Code", title: "Claude session", decoderVersion: "claude-jsonl-v1" },
      { id: codex.id, sourceId: "codex", nativeSessionId: "codex-active-1", client: "Codex", title: "Codex active session", decoderVersion: "codex-rollout-v1" },
    ],
    model: "test-model",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    progress: "ready",
    edits: [
      {
        id: "edit-codex",
        operation: "replace",
        oldText: "initial guidance before codex review\n",
        newText: "updated guidance with codex verification command\n",
        title: "Codex verified guidance edit",
        rationale: "r",
        category: "process",
        usefulness: "high",
        evidence: [
          { sessionId: codex.id, entryId: codexEntry.id },
          { sessionId: codex.id, callRef: codexEntry.tool!.callRef, section: "output" },
        ],
      },
    ],
    decisions: { "edit-codex": "selected" },
    evidence: {},
  };

  await mkdir(resolve(root, "data"), { recursive: true });
  await writeFile(resolve(root, "data/guidance-reviews.json"), JSON.stringify({ version: 1, reviews: [review] }), "utf8");

  const applied = await service.applyEdits(review.id, ["edit-codex"]);
  assert.equal(applied.status, "applied");
  assert.equal(await readFile(target, "utf8"), "updated guidance with codex verification command\n");
});

test("formatTimeAgo formats session relative age concisely", async () => {
  const { formatTimeAgo } = await import("../web/lib/format.ts");
  const now = new Date("2026-09-07T14:00:00.000Z").getTime();
  assert.equal(formatTimeAgo("2026-09-07T13:59:45.000Z", now), "< 1m ago");
  assert.equal(formatTimeAgo("2026-09-07T13:59:00.000Z", now), "1m ago");
  assert.equal(formatTimeAgo("2026-09-07T13:48:52.000Z", now), "11m ago");
  assert.equal(formatTimeAgo("2026-09-07T12:00:00.000Z", now), "2h ago");
  assert.equal(formatTimeAgo("2026-09-05T14:00:00.000Z", now), "2d ago");
  assert.equal(formatTimeAgo("2026-07-07T14:00:00.000Z", now), "2mo ago");
  assert.equal(formatTimeAgo("2025-09-07T14:00:00.000Z", now), "1y ago");
  assert.equal(formatTimeAgo(null, now), null);
  assert.equal(formatTimeAgo("invalid", now), null);
});


