import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  asIso,
  asObject,
  asString,
  decodeCodexProjectedItems,
  decodeCodexRolloutRecords,
  getCodexToolPayloadFromProjectedRows,
  getCodexToolPayloadFromRecords,
  type ProjectedItemRow,
} from "./codexDecoder.ts";
import { findJsonlRecord, hashJsonl, readJsonl } from "./jsonl.ts";
import type { GuidanceHistorySource, LocalHistory, LocalSessionSummary } from "./source.ts";

export const CODEX_ROLLOUT_DECODER_VERSION = "codex-rollout-v1";
export const CODEX_PROJECTED_DECODER_VERSION = "codex-projected-v1";

interface CodexSessionInfo {
  id: string;
  path: string;
  cwd: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  historyMode?: string;
  isArchived?: boolean;
}

function sanitizeTitle(raw?: string): string | undefined {
  if (!raw) return undefined;
  const line = raw.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0);
  if (!line) return undefined;
  const stripped = line.replace(/^[#\s*-]+/, "").trim();
  if (!stripped) return undefined;
  return stripped.length > 120 ? `${stripped.slice(0, 117)}...` : stripped;
}

export class CodexHistorySource implements GuidanceHistorySource {
  readonly id = "codex" as const;
  private readonly codexHome?: string;

  constructor(codexHome?: string) {
    this.codexHome = codexHome;
  }

  async listSessions(checkout: string): Promise<LocalSessionSummary[]> {
    const root = this.root();
    if (!existsSync(root)) {
      throw new Error(`Codex history is unavailable at ${root}`);
    }

    const canonicalCheckout = await this.canonicalPath(checkout);
    if (!canonicalCheckout) return [];

    const sessions = await this.discoverRollouts(root, canonicalCheckout);
    return sessions.map((session) => this.summary(session, canonicalCheckout));
  }

  async getHistory(checkout: string, nativeSessionId: string): Promise<LocalHistory> {
    const session = await this.requireSession(checkout, nativeSessionId);
    const projected = await this.tryReadProjectedHistory(nativeSessionId, session.path);
    if (projected) {
      return projected;
    }

    const transcript = await readJsonl(session.path);
    return {
      entries: decodeCodexRolloutRecords(transcript.records),
      version: transcript.version,
      incomplete: transcript.incomplete,
    };
  }

  async getToolPayload(
    checkout: string,
    nativeSessionId: string,
    nativeCallId: string,
    section: "input" | "output" | "error",
  ): Promise<{ content?: string; available: boolean; version: string }> {
    const session = await this.requireSession(checkout, nativeSessionId);
    const projected = await this.tryReadProjectedPayload(nativeSessionId, session.path, nativeCallId, section);
    if (projected) {
      return projected;
    }

    const transcript = await readJsonl(session.path);
    return getCodexToolPayloadFromRecords(transcript.records, nativeCallId, section, transcript.version);
  }

  async getSessionVersion(checkout: string, nativeSessionId: string): Promise<string> {
    const session = await this.requireSession(checkout, nativeSessionId);
    const projectedVersion = await this.tryGetProjectedVersion(nativeSessionId, session.path);
    if (projectedVersion) {
      return projectedVersion;
    }
    return hashJsonl(session.path);
  }

  async listGlobalRecentSessions(limit: number): Promise<LocalSessionSummary[]> {
    const root = this.root();
    if (!existsSync(root)) return [];
    const sessions = await this.discoverGlobalRollouts(root, limit);
    return sessions.map((session) => this.summary(session, session.cwd));
  }

  async getGlobalHistory(nativeSessionId: string): Promise<LocalHistory> {
    const session = await this.findGlobalSession(nativeSessionId);
    if (!session || !existsSync(session.path)) {
      throw new Error("Local transcript unavailable.");
    }
    const projected = await this.tryReadProjectedHistory(nativeSessionId, session.path);
    if (projected) {
      return projected;
    }
    const transcript = await readJsonl(session.path);
    return {
      entries: decodeCodexRolloutRecords(transcript.records),
      version: transcript.version,
      incomplete: transcript.incomplete,
    };
  }

  async getGlobalSessionVersion(nativeSessionId: string): Promise<string> {
    const session = await this.findGlobalSession(nativeSessionId);
    if (!session || !existsSync(session.path)) {
      throw new Error("Local transcript unavailable.");
    }
    const projectedVersion = await this.tryGetProjectedVersion(nativeSessionId, session.path);
    if (projectedVersion) {
      return projectedVersion;
    }
    return hashJsonl(session.path);
  }

  private root(): string {
    return this.codexHome?.trim() || process.env.CODEX_HOME || resolve(homedir(), ".codex");
  }

  private async requireSession(checkout: string, nativeSessionId: string): Promise<CodexSessionInfo> {
    const canonicalCheckout = (await this.canonicalPath(checkout)) ?? checkout;
    const sessions = await this.discoverRollouts(this.root(), canonicalCheckout);
    const session = sessions.find((candidate) => candidate.id === nativeSessionId);
    if (!session) {
      throw new Error("Codex session is not associated with this checkout");
    }
    return session;
  }

  private summary(session: CodexSessionInfo, checkout: string): LocalSessionSummary {
    const hasUnsupportedMode = session.historyMode && session.historyMode !== "rollout";
    return {
      nativeSessionId: session.id,
      title: session.title,
      directory: session.cwd || checkout,
      parentId: null,
      relatedChild: false,
      client: "Codex",
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      decoderVersion: CODEX_ROLLOUT_DECODER_VERSION,
      available: true,
      limitations: hasUnsupportedMode ? `Codex history mode: ${session.historyMode}` : undefined,
    };
  }

  private async discoverRollouts(root: string, canonicalCheckout: string): Promise<CodexSessionInfo[]> {
    const candidateDirs = [resolve(root, "sessions"), resolve(root, "archived_sessions")];
    const files: string[] = [];

    for (const dir of candidateDirs) {
      if (!existsSync(dir)) continue;
      const found = await this.jsonlFiles(dir);
      files.push(...found);
    }

    const threadMetaMap = await this.readStateThreads(root);
    const sessions: CodexSessionInfo[] = [];

    for (const file of files) {
      if (file.endsWith("/history.jsonl") || file.endsWith("\\history.jsonl")) continue;

      try {
        const metaRecord = await findJsonlRecord(file, (record) => {
          const obj = asObject(record);
          return obj?.type === "session_meta" || obj?.type === "session";
        });

        const metaObj = asObject(metaRecord);
        const payload = asObject(metaObj?.payload) ?? metaObj;
        const recordedCwd = asString(payload?.cwd);
        if (!recordedCwd) continue;

        const canonicalSessionCwd = await this.canonicalPath(recordedCwd);
        if (canonicalSessionCwd !== canonicalCheckout) continue;

        const sessionId =
          asString(payload?.id) ??
          asString(payload?.session_id) ??
          file.slice(file.lastIndexOf("/") + 1).replace(/\.jsonl$/, "");

        const stateThread = threadMetaMap.get(sessionId);
        const isArchived = file.includes("/archived_sessions/") || file.includes("\\archived_sessions\\");
        const title =
          sanitizeTitle(stateThread?.title) ||
          sanitizeTitle(stateThread?.name) ||
          "Untitled Codex session";

        const statInfo = await lstat(file).catch(() => undefined);
        const metaTimestamp = asIso(metaObj?.timestamp) ?? asIso(payload?.timestamp);
        const createdAt =
          stateThread?.createdAt ??
          metaTimestamp ??
          (statInfo ? new Date(statInfo.birthtimeMs || statInfo.mtimeMs).toISOString() : undefined);
        const updatedAt =
          stateThread?.updatedAt ??
          metaTimestamp ??
          (statInfo ? new Date(statInfo.mtimeMs).toISOString() : undefined);

        sessions.push({
          id: sessionId,
          path: file,
          cwd: recordedCwd,
          title,
          createdAt,
          updatedAt,
          historyMode: asString(payload?.history_mode),
          isArchived,
        });
      } catch {
        // A changing or unreadable rollout file is skipped during discovery
      }
    }

    return sessions;
  }

  private async discoverGlobalRollouts(root: string, limit: number): Promise<CodexSessionInfo[]> {
    const candidateDirs = [resolve(root, "sessions"), resolve(root, "archived_sessions")];
    const files: string[] = [];

    for (const dir of candidateDirs) {
      if (!existsSync(dir)) continue;
      const found = await this.jsonlFiles(dir);
      files.push(...found);
    }

    const filteredFiles = files.filter(
      (file) => !file.endsWith("/history.jsonl") && !file.endsWith("\\history.jsonl")
    );

    const fileStats: Array<{ path: string; mtime: number }> = [];
    for (const file of filteredFiles) {
      try {
        const st = await lstat(file);
        fileStats.push({ path: file, mtime: st.mtimeMs });
      } catch {
        // Skip unreadable
      }
    }
    fileStats.sort((a, b) => b.mtime - a.mtime);

    const threadMetaMap = await this.readStateThreads(root);
    const sessions: CodexSessionInfo[] = [];

    for (const item of fileStats) {
      if (sessions.length >= limit) break;
      const file = item.path;
      try {
        const metaRecord = await findJsonlRecord(file, (record) => {
          const obj = asObject(record);
          return obj?.type === "session_meta" || obj?.type === "session";
        });

        const metaObj = asObject(metaRecord);
        const payload = asObject(metaObj?.payload) ?? metaObj;
        const recordedCwd = asString(payload?.cwd);

        const sessionId =
          asString(payload?.id) ??
          asString(payload?.session_id) ??
          file.slice(file.lastIndexOf("/") + 1).replace(/\.jsonl$/, "");

        const stateThread = threadMetaMap.get(sessionId);
        const isArchived = file.includes("/archived_sessions/") || file.includes("\\archived_sessions\\");
        const title =
          sanitizeTitle(stateThread?.title) ||
          sanitizeTitle(stateThread?.name) ||
          sanitizeTitle(asString(payload?.title)) ||
          "Untitled Codex session";

        const metaTimestamp = asIso(metaObj?.timestamp) ?? asIso(payload?.timestamp);
        const createdAt =
          stateThread?.createdAt ??
          metaTimestamp ??
          new Date(item.mtime).toISOString();
        const updatedAt =
          stateThread?.updatedAt ??
          metaTimestamp ??
          new Date(item.mtime).toISOString();

        sessions.push({
          id: sessionId,
          path: file,
          cwd: recordedCwd ?? "",
          title,
          createdAt,
          updatedAt,
          historyMode: asString(payload?.history_mode),
          isArchived,
        });
      } catch {
        // Skip
      }
    }

    return sessions;
  }

  private async findGlobalSession(nativeSessionId: string): Promise<CodexSessionInfo | undefined> {
    const root = this.root();
    const candidateDirs = [resolve(root, "sessions"), resolve(root, "archived_sessions")];
    const files: string[] = [];
    for (const dir of candidateDirs) {
      if (!existsSync(dir)) continue;
      files.push(...(await this.jsonlFiles(dir)));
    }
    const threadMetaMap = await this.readStateThreads(root);
    const prioritized = files.filter((f) => f.endsWith(`${nativeSessionId}.jsonl`));
    const rest = files.filter((f) => !f.endsWith(`${nativeSessionId}.jsonl`));
    const ordered = [...prioritized, ...rest];

    for (const file of ordered) {
      if (file.endsWith("/history.jsonl") || file.endsWith("\\history.jsonl")) continue;
      try {
        const metaRecord = await findJsonlRecord(file, (record) => {
          const obj = asObject(record);
          return obj?.type === "session_meta" || obj?.type === "session";
        });
        const metaObj = asObject(metaRecord);
        const payload = asObject(metaObj?.payload) ?? metaObj;
        const sessionId =
          asString(payload?.id) ??
          asString(payload?.session_id) ??
          file.slice(file.lastIndexOf("/") + 1).replace(/\.jsonl$/, "");
        if (sessionId === nativeSessionId) {
          const recordedCwd = asString(payload?.cwd) ?? "";
          const stateThread = threadMetaMap.get(sessionId);
          const isArchived = file.includes("/archived_sessions/") || file.includes("\\archived_sessions\\");
          const title =
            sanitizeTitle(stateThread?.title) ||
            sanitizeTitle(stateThread?.name) ||
            sanitizeTitle(asString(payload?.title)) ||
            "Untitled Codex session";
          const statInfo = await lstat(file).catch(() => undefined);
          const metaTimestamp = asIso(metaObj?.timestamp) ?? asIso(payload?.timestamp);
          const createdAt =
            stateThread?.createdAt ??
            metaTimestamp ??
            (statInfo ? new Date(statInfo.birthtimeMs || statInfo.mtimeMs).toISOString() : undefined);
          const updatedAt =
            stateThread?.updatedAt ??
            metaTimestamp ??
            (statInfo ? new Date(statInfo.mtimeMs).toISOString() : undefined);
          return {
            id: sessionId,
            path: file,
            cwd: recordedCwd,
            title,
            createdAt,
            updatedAt,
            historyMode: asString(payload?.history_mode),
            isArchived,
          };
        }
      } catch {
        // Skip
      }
    }
    return undefined;
  }

  private async readStateThreads(
    root: string,
  ): Promise<Map<string, { title?: string; name?: string; createdAt?: string; updatedAt?: string }>> {
    const map = new Map<string, { title?: string; name?: string; createdAt?: string; updatedAt?: string }>();
    const stateDbPath = resolve(root, "state_5.sqlite");
    if (!existsSync(stateDbPath)) return map;

    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(stateDbPath, { readOnly: true });
      const tableCheck = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='threads'")
        .get() as { name?: string } | undefined;
      if (!tableCheck) return map;

      const rows = db
        .prepare("SELECT id, title, name, created_at, updated_at FROM threads")
        .all() as Array<{ id: unknown; title: unknown; name: unknown; created_at: unknown; updated_at: unknown }>;

      for (const row of rows) {
        const id = asString(row.id);
        if (id) {
          map.set(id, {
            title: asString(row.title),
            name: asString(row.name),
            createdAt: asIso(row.created_at),
            updatedAt: asIso(row.updated_at),
          });
        }
      }
    } catch {
      // Database locked or schema difference: fallback to neutral titles
    } finally {
      db?.close();
    }

    return map;
  }

  private async tryReadProjectedHistory(threadId: string, rolloutPath: string): Promise<LocalHistory | undefined> {
    const root = this.root();
    const historyDbPath = resolve(root, "thread_history_1.sqlite");
    if (!existsSync(historyDbPath)) return undefined;

    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(historyDbPath, { readOnly: true });
      if (!this.verifyProjectedSchema(db)) return undefined;

      const projectionState = db
        .prepare("SELECT thread_id, next_rollout_byte_offset FROM thread_history_projection_state WHERE thread_id = ?")
        .get(threadId) as { thread_id: string; next_rollout_byte_offset: number } | undefined;

      if (!projectionState) return undefined;

      // Verify that projection matches current rollout size
      const rolloutStat = await lstat(rolloutPath).catch(() => undefined);
      if (!rolloutStat || rolloutStat.size !== projectionState.next_rollout_byte_offset) {
        // Projection is stale or partial
        return undefined;
      }

      const rows = db
        .prepare(
          "SELECT item_id, item_type, item_json, rollout_ordinal, created_at_ms FROM thread_items WHERE thread_id = ? ORDER BY rollout_ordinal ASC, created_at_ms ASC, item_id ASC",
        )
        .all(threadId) as unknown as ProjectedItemRow[];

      if (rows.length === 0) return undefined;

      const entries = decodeCodexProjectedItems(rows);
      const version = this.hashProjectedRows(rows, projectionState.next_rollout_byte_offset);
      return { entries, version };
    } catch {
      return undefined;
    } finally {
      db?.close();
    }
  }

  private async tryReadProjectedPayload(
    threadId: string,
    rolloutPath: string,
    nativeCallId: string,
    section: "input" | "output" | "error",
  ): Promise<{ content?: string; available: boolean; version: string } | undefined> {
    const root = this.root();
    const historyDbPath = resolve(root, "thread_history_1.sqlite");
    if (!existsSync(historyDbPath)) return undefined;

    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(historyDbPath, { readOnly: true });
      if (!this.verifyProjectedSchema(db)) return undefined;

      const projectionState = db
        .prepare("SELECT thread_id, next_rollout_byte_offset FROM thread_history_projection_state WHERE thread_id = ?")
        .get(threadId) as { thread_id: string; next_rollout_byte_offset: number } | undefined;

      if (!projectionState) return undefined;
      const rolloutStat = await lstat(rolloutPath).catch(() => undefined);
      if (!rolloutStat || rolloutStat.size !== projectionState.next_rollout_byte_offset) return undefined;

      const rows = db
        .prepare(
          "SELECT item_id, item_type, item_json, rollout_ordinal, created_at_ms FROM thread_items WHERE thread_id = ? ORDER BY rollout_ordinal ASC, created_at_ms ASC, item_id ASC",
        )
        .all(threadId) as unknown as ProjectedItemRow[];

      const version = this.hashProjectedRows(rows, projectionState.next_rollout_byte_offset);
      return getCodexToolPayloadFromProjectedRows(rows, nativeCallId, section, version);
    } catch {
      return undefined;
    } finally {
      db?.close();
    }
  }

  private async tryGetProjectedVersion(threadId: string, rolloutPath: string): Promise<string | undefined> {
    const root = this.root();
    const historyDbPath = resolve(root, "thread_history_1.sqlite");
    if (!existsSync(historyDbPath)) return undefined;

    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(historyDbPath, { readOnly: true });
      if (!this.verifyProjectedSchema(db)) return undefined;

      const projectionState = db
        .prepare("SELECT thread_id, next_rollout_byte_offset FROM thread_history_projection_state WHERE thread_id = ?")
        .get(threadId) as { thread_id: string; next_rollout_byte_offset: number } | undefined;

      if (!projectionState) return undefined;
      const rolloutStat = await lstat(rolloutPath).catch(() => undefined);
      if (!rolloutStat || rolloutStat.size !== projectionState.next_rollout_byte_offset) return undefined;

      const rows = db
        .prepare(
          "SELECT item_id, item_type, item_json, rollout_ordinal, created_at_ms FROM thread_items WHERE thread_id = ? ORDER BY rollout_ordinal ASC, created_at_ms ASC, item_id ASC",
        )
        .all(threadId) as unknown as ProjectedItemRow[];

      return this.hashProjectedRows(rows, projectionState.next_rollout_byte_offset);
    } catch {
      return undefined;
    } finally {
      db?.close();
    }
  }

  private verifyProjectedSchema(db: DatabaseSync): boolean {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
        (r) => r.name,
      ),
    );
    return tables.has("thread_items") && tables.has("thread_history_projection_state");
  }

  private hashProjectedRows(rows: ProjectedItemRow[], watermarkOffset: number): string {
    const digest = createHash("sha256");
    digest.update(String(watermarkOffset));
    for (const row of rows) {
      digest.update(row.item_id);
      digest.update(String(row.rollout_ordinal));
      digest.update(row.item_type);
      digest.update(row.item_json);
    }
    return digest.digest("hex");
  }

  private async canonicalPath(path: string): Promise<string | undefined> {
    try {
      return await realpath(path);
    } catch {
      return undefined;
    }
  }

  private async jsonlFiles(root: string): Promise<string[]> {
    const found: string[] = [];
    const pending = [root];
    while (pending.length) {
      const directory = pending.pop()!;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          pending.push(path);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          found.push(path);
        }
      }
    }
    return found;
  }
}
