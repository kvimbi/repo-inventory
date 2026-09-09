import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bounded, hash, textChunks } from "./bounds.ts";
import type { GuidanceHistorySource, LocalHistory, LocalHistoryEntry, LocalSessionSummary } from "./source.ts";

interface Row { [key: string]: unknown; }

function parseJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function stringValue(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function isoTime(value: unknown): string | undefined { return typeof value === "number" ? new Date(value).toISOString() : undefined; }

export class OpenCodeHistorySource implements GuidanceHistorySource {
  readonly id = "opencode" as const;
  private readonly databasePath?: string;

  constructor(databasePath?: string) { this.databasePath = databasePath; }

  async listSessions(checkout: string): Promise<LocalSessionSummary[]> {
    const db = this.openDatabase();
    try {
      const sessions = db.prepare("SELECT id, title, directory, parent_id, time_created, time_updated FROM session ORDER BY time_updated DESC").all() as Row[];
      const direct = sessions.filter((row) => this.canonicalDirectory(row.directory) === checkout);
      const directIds = new Set(direct.map((row) => String(row.id)));
      return sessions.filter((row) => directIds.has(String(row.id)) || directIds.has(String(row.parent_id ?? ""))).map((row) => ({
        nativeSessionId: String(row.id), title: typeof row.title === "string" ? row.title : "Untitled session", directory: typeof row.directory === "string" ? row.directory : undefined,
        parentId: typeof row.parent_id === "string" ? row.parent_id : null, createdAt: isoTime(row.time_created), updatedAt: isoTime(row.time_updated),
        relatedChild: !directIds.has(String(row.id)), client: "OpenCode", decoderVersion: "opencode-sqlite-v1",
      }));
    } finally { db.close(); }
  }

  async getHistory(_checkout: string, nativeSessionId: string): Promise<LocalHistory> {
    const db = this.openDatabase();
    try { return { entries: this.historyRecords(db, nativeSessionId), version: this.sessionVersion(db, nativeSessionId) }; } finally { db.close(); }
  }

  async getToolPayload(_checkout: string, nativeSessionId: string, nativeCallId: string, section: "input" | "output" | "error"): Promise<{ content?: string; available: boolean; version: string }> {
    const db = this.openDatabase();
    try {
      const version = this.sessionVersion(db, nativeSessionId);
      const row = db.prepare("SELECT data FROM part WHERE id = ? AND session_id = ?").get(nativeCallId, nativeSessionId) as Row | undefined;
      const raw = row ? parseJson(parseJson(row.data).state)[section] : undefined;
      return raw === undefined || raw === null ? { available: false, version } : { content: typeof raw === "string" ? raw : JSON.stringify(raw), available: true, version };
    } finally { db.close(); }
  }

  async getSessionVersion(_checkout: string, nativeSessionId: string): Promise<string> {
    const db = this.openDatabase();
    try { return this.sessionVersion(db, nativeSessionId); } finally { db.close(); }
  }

  async listGlobalRecentSessions(limit: number): Promise<LocalSessionSummary[]> {
    let db: DatabaseSync;
    try {
      db = this.openDatabase();
    } catch {
      return [];
    }
    try {
      const sessions = db.prepare("SELECT id, title, directory, parent_id, time_created, time_updated FROM session ORDER BY time_updated DESC LIMIT ?").all(limit) as Row[];
      return sessions.map((row) => ({
        nativeSessionId: String(row.id),
        title: typeof row.title === "string" ? row.title : "Untitled session",
        directory: typeof row.directory === "string" ? row.directory : undefined,
        parentId: typeof row.parent_id === "string" ? row.parent_id : null,
        createdAt: isoTime(row.time_created),
        updatedAt: isoTime(row.time_updated),
        relatedChild: Boolean(row.parent_id),
        client: "OpenCode",
        decoderVersion: "opencode-sqlite-v1",
      }));
    } finally {
      db.close();
    }
  }

  async getGlobalHistory(nativeSessionId: string): Promise<LocalHistory> {
    return this.getHistory("", nativeSessionId);
  }

  async getGlobalSessionVersion(nativeSessionId: string): Promise<string> {
    return this.getSessionVersion("", nativeSessionId);
  }

  private historyRecords(db: DatabaseSync, sessionId: string): LocalHistoryEntry[] {
    const rows = db.prepare("SELECT p.id AS part_id, p.message_id, p.session_id, p.time_created AS part_created, p.data AS part_data, m.data AS message_data FROM part p JOIN message m ON m.id = p.message_id WHERE p.session_id = ? ORDER BY m.time_created, p.time_created, p.id").all(sessionId) as Row[];
    return rows.flatMap((row) => {
      const data = parseJson(row.part_data); const message = parseJson(row.message_data); const type = stringValue(data.type) ?? "unsupported";
      const entry: Omit<LocalHistoryEntry, "nativeRecordId"> = { messageId: String(row.message_id), partId: String(row.part_id), createdAt: isoTime(row.part_created), role: message.role === "user" || message.role === "assistant" ? message.role : undefined, type };
      if (type === "text" || type === "reasoning") {
        const text = stringValue(data.text);
        if (text !== undefined) return textChunks(text).map((chunk, chunkIndex) => ({ ...entry, nativeRecordId: String(row.part_id), chunkIndex, text: chunk, unavailable: chunkIndex === 0 ? undefined : `text chunk ${chunkIndex + 1}` }));
        return [{ ...entry, nativeRecordId: String(row.part_id), unavailable: "text payload unavailable" }];
      }
      if (type === "tool") {
        const state = parseJson(data.state); const input = state.input === undefined ? undefined : JSON.stringify(state.input); const error = state.error === undefined ? undefined : typeof state.error === "string" ? state.error : JSON.stringify(state.error);
        const inputBound = input === undefined ? { omitted: false } : bounded(input); const errorBound = error === undefined ? { omitted: false } : bounded(error);
        return [{ ...entry, nativeRecordId: String(row.part_id), tool: { nativeCallId: String(row.part_id), name: stringValue(data.tool) ?? "unknown", status: stringValue(state.status) ?? "unknown", input: inputBound.text, inputOmitted: inputBound.omitted, error: errorBound.text, errorOmitted: errorBound.omitted, outputAvailable: state.output !== undefined } }];
      }
      return [["step-start", "step-finish", "file", "patch"].includes(type) ? { ...entry, nativeRecordId: String(row.part_id) } : { ...entry, nativeRecordId: String(row.part_id), unavailable: `unsupported persisted part type: ${type}` }];
    });
  }

  private sessionVersion(db: DatabaseSync, sessionId: string): string {
    const rows = db.prepare("SELECT p.id, p.time_updated, p.data, m.time_updated AS message_updated, m.data AS message_data FROM part p JOIN message m ON m.id = p.message_id WHERE p.session_id = ? ORDER BY p.id").all(sessionId) as Row[];
    const session = db.prepare("SELECT time_updated FROM session WHERE id = ?").get(sessionId) as Row | undefined;
    if (!session) throw new Error("OpenCode session is unavailable");
    return hash(JSON.stringify({ updated: session.time_updated, rows }));
  }

  private openDatabase(): DatabaseSync {
    const source = this.databasePath?.trim() || resolve(homedir(), ".local/share/opencode/opencode.db");
    if (!existsSync(source)) throw new Error(`OpenCode history database is unavailable at ${source}`);
    const db = new DatabaseSync(source, { readOnly: true });
    const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((row) => String(row.name)));
    if (!["session", "message", "part"].every((name) => names.has(name))) { db.close(); throw new Error("unsupported OpenCode history schema: session, message, and part tables are required"); }
    return db;
  }

  private canonicalDirectory(value: unknown): string | undefined {
    if (typeof value !== "string" || value.length === 0) return undefined;
    try { return realpathSync(value); } catch { return undefined; }
  }
}
