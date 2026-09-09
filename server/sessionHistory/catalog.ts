import { existsSync, realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import type {
  AgentToolId,
  GuidanceHistoryEntry,
  GuidanceHistoryPage,
  GuidanceHistorySourceDiagnostic,
  GuidanceSessionList,
  GuidanceSessionSummary,
  GuidanceToolPayload,
  RecentSessionSummary,
  ToolCapabilityResult,
} from "../../core/types.ts";
import { MAX_SESSIONS_PER_TOOL, PAGE_BYTES, PAGE_ENTRIES, PAYLOAD_BYTES, utf8Chunk } from "./bounds.ts";
import { callReference, decodeCallReference, decodeEntryReference, decodeSessionReference, entryReference, sessionReference } from "./references.ts";
import type { GuidanceHistorySource, LocalHistory, LocalHistoryEntry, LocalSessionSummary } from "./source.ts";

interface Cursor { sourceId: string; nativeSessionId: string; version: string; offset: number; callId?: string; section?: "input" | "output" | "error"; }

function encodeCursor(value: Cursor): string { return Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); }
function decodeCursor(value: string | undefined): Cursor | undefined {
  if (!value) return undefined;
  try { const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); const item = parsed && typeof parsed === "object" ? parsed as Partial<Cursor> : undefined;
    if (!item || typeof item.sourceId !== "string" || typeof item.nativeSessionId !== "string" || typeof item.version !== "string" || typeof item.offset !== "number" || !Number.isInteger(item.offset) || item.offset < 0) throw new Error("invalid");
    if (item.section !== undefined && item.section !== "input" && item.section !== "output" && item.section !== "error") throw new Error("invalid");
    return item as Cursor;
  } catch { throw new Error("invalid history cursor"); }
}

export class GuidanceHistoryCatalog {
  private readonly sources: GuidanceHistorySource[];

  constructor(sources: GuidanceHistorySource[]) { this.sources = sources; }

  async listSessions(checkout: string): Promise<GuidanceSessionList> {
    const canonicalCheckout = await this.requireCheckout(checkout);
    const sessions: GuidanceSessionSummary[] = []; const diagnostics: GuidanceHistorySourceDiagnostic[] = [];
    for (const source of this.sources) {
      try {
        const listed = await source.listSessions(canonicalCheckout);
        const summaries = listed.map((session) => this.summary(source.id, session, ""));
        sessions.push(...summaries);
        diagnostics.push({ id: source.id, state: "ready" });
      } catch (error) { diagnostics.push({ id: source.id, state: this.missing(error) ? "missing" : "error", reason: error instanceof Error ? error.message : String(error) }); }
    }
    sessions.sort((a, b) => {
      const timeA = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      const timeB = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
      return timeB - timeA;
    });
    return { sessions, sources: diagnostics };
  }

  async getHistory(checkout: string, id: string, pageCursor?: string, allowLegacy = false): Promise<GuidanceHistoryPage> {
    const reference = decodeSessionReference(id, allowLegacy); const source = this.source(reference.sourceId); const canonicalCheckout = await this.requireCheckout(checkout);
    await this.assertVisible(source, canonicalCheckout, reference.nativeSessionId);
    const history = await source.getHistory(canonicalCheckout, reference.nativeSessionId); const cursor = decodeCursor(pageCursor);
    if (cursor && (cursor.sourceId !== source.id || cursor.nativeSessionId !== reference.nativeSessionId || cursor.version !== history.version || cursor.callId || cursor.section)) throw new Error("history cursor does not belong to this session or its content changed; restart the review");
    const offset = cursor?.offset ?? 0; const entries: GuidanceHistoryEntry[] = []; let bytes = 0; let index = offset;
    while (index < history.entries.length && entries.length < PAGE_ENTRIES) { const candidate = this.entry(source.id, reference.nativeSessionId, history.entries[index]); const size = Buffer.byteLength(JSON.stringify(candidate), "utf8"); if (entries.length && bytes + size > PAGE_BYTES) break; entries.push(candidate); bytes += size; index += 1; }
    if (await source.getSessionVersion(canonicalCheckout, reference.nativeSessionId) !== history.version) throw new Error("session history changed while it was read; restart the review");
    return { entries, hasMore: index < history.entries.length, nextCursor: index < history.entries.length ? encodeCursor({ sourceId: source.id, nativeSessionId: reference.nativeSessionId, version: history.version, offset: index }) : undefined, sourceVersion: history.version, incomplete: history.incomplete };
  }

  async getToolPayload(checkout: string, ref: string, section: "input" | "output" | "error", payloadCursor?: string, allowLegacy = false): Promise<GuidanceToolPayload> {
    const call = decodeCallReference(ref, allowLegacy); const source = this.source(call.sourceId); const canonicalCheckout = await this.requireCheckout(checkout);
    await this.assertVisible(source, canonicalCheckout, call.nativeSessionId);
    const payload = await source.getToolPayload(canonicalCheckout, call.nativeSessionId, call.nativeCallId, section); const cursor = decodeCursor(payloadCursor);
    if (cursor && (cursor.sourceId !== source.id || cursor.nativeSessionId !== call.nativeSessionId || cursor.callId !== call.nativeCallId || cursor.section !== section || cursor.version !== payload.version)) throw new Error("history cursor does not belong to this tool payload or its content changed; restart the review");
    if (!payload.available || payload.content === undefined) return { callRef: ref, section, available: false, hasMore: false, sourceVersion: payload.version };
    const offset = cursor?.offset ?? 0; const chunk = utf8Chunk(payload.content, offset, PAYLOAD_BYTES); const hasMore = chunk.next < Buffer.byteLength(payload.content, "utf8");
    if (await source.getSessionVersion(canonicalCheckout, call.nativeSessionId) !== payload.version) throw new Error("session history changed while it was read; restart the review");
    return { callRef: ref, section, content: chunk.content, available: true, hasMore, nextCursor: hasMore ? encodeCursor({ sourceId: source.id, nativeSessionId: call.nativeSessionId, version: payload.version, offset: chunk.next, callId: call.nativeCallId, section }) : undefined, sourceVersion: payload.version };
  }

  async listGlobalRecentSessions(
    toolId: AgentToolId,
    limit: number,
    knownProjects?: Array<{ id: string; name: string; path: string }>
  ): Promise<ToolCapabilityResult<RecentSessionSummary>> {
    if (toolId === "antigravity") {
      return {
        state: "unsupported",
        items: [],
        reason: "Antigravity sessions unsupported in V1 because native session decoders (SQLite binary blobs / protocol buffers) are outside V1 scope.",
      };
    }
    if (toolId === "gemini") {
      return {
        state: "unsupported",
        items: [],
        reason: "Gemini CLI sessions unsupported in V1 because native session decoders are outside V1 scope.",
      };
    }

    const sourceIds: Array<GuidanceHistorySource["id"]> =
      toolId === "opencode"
        ? ["opencode"]
        : toolId === "codex"
          ? ["codex"]
          : toolId === "claude"
            ? ["claude", "cowork"]
            : [];

    const matchedSources = this.sources.filter((s) => sourceIds.includes(s.id));
    const rawSessions: Array<{ sourceId: GuidanceHistorySource["id"]; session: LocalSessionSummary }> = [];

    for (const src of matchedSources) {
      if (typeof src.listGlobalRecentSessions === "function") {
        try {
          const sessions = await src.listGlobalRecentSessions(limit);
          for (const s of sessions) {
            rawSessions.push({ sourceId: src.id, session: s });
          }
        } catch {
          // Source discovery error gracefully ignored
        }
      }
    }

    const items: RecentSessionSummary[] = rawSessions.map(({ sourceId, session }) => {
      let projectAssociation: RecentSessionSummary["projectAssociation"];
      if (session.directory) {
        let canonicalDir = session.directory;
        try {
          canonicalDir = realpathSync(session.directory);
        } catch {
          // keep original
        }

        const matchedProject = knownProjects?.find((p) => {
          let canonicalProj = p.path;
          try {
            canonicalProj = realpathSync(p.path);
          } catch {}
          return canonicalProj === canonicalDir || p.path === session.directory;
        });

        if (matchedProject) {
          projectAssociation = {
            kind: "known_project",
            projectId: matchedProject.id,
            name: matchedProject.name,
            path: matchedProject.path,
          };
        } else if (existsSync(session.directory)) {
          projectAssociation = {
            kind: "external_folder",
            path: session.directory,
          };
        } else {
          projectAssociation = {
            kind: "projectless",
          };
        }
      } else {
        projectAssociation = {
          kind: "projectless",
        };
      }

      const lastActivityAt = session.updatedAt ?? session.createdAt ?? new Date(0).toISOString();
      return {
        id: sessionReference(sourceId, session.nativeSessionId),
        toolId,
        title: session.title,
        clientMode: session.client,
        lastActivityAt,
        projectAssociation,
        transcriptAvailable: session.available !== false,
      };
    });

    items.sort((a, b) => {
      const timeA = new Date(a.lastActivityAt).getTime();
      const timeB = new Date(b.lastActivityAt).getTime();
      return timeB - timeA;
    });

    const maxLimit = Math.min(limit, MAX_SESSIONS_PER_TOOL);
    const truncated = items.length > maxLimit;
    const cappedItems = items.slice(0, maxLimit);

    return {
      state: "ready",
      items: cappedItems,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  async getGlobalHistory(sessionId: string, pageCursor?: string): Promise<GuidanceHistoryPage> {
    let reference: { sourceId: string; nativeSessionId: string };
    try {
      reference = decodeSessionReference(sessionId, false);
    } catch {
      return { entries: [], hasMore: false, sourceVersion: "", available: false, reason: "Local transcript unavailable." };
    }

    const source = this.sources.find((candidate) => candidate.id === reference.sourceId);
    if (!source) {
      return { entries: [], hasMore: false, sourceVersion: "", available: false, reason: "Local transcript unavailable." };
    }

    let history: LocalHistory;
    try {
      history = source.getGlobalHistory
        ? await source.getGlobalHistory(reference.nativeSessionId)
        : await source.getHistory("", reference.nativeSessionId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        entries: [],
        hasMore: false,
        sourceVersion: "",
        available: false,
        reason: msg.includes("unavailable") || msg.includes("ENOENT") ? "Local transcript unavailable." : msg,
      };
    }

    const cursor = decodeCursor(pageCursor);
    if (cursor && (cursor.sourceId !== source.id || cursor.nativeSessionId !== reference.nativeSessionId || cursor.version !== history.version || cursor.callId || cursor.section)) {
      throw new Error("history cursor does not belong to this session or its content changed; restart the review");
    }

    const offset = cursor?.offset ?? 0;
    const entries: GuidanceHistoryEntry[] = [];
    let bytes = 0;
    let index = offset;
    while (index < history.entries.length && entries.length < PAGE_ENTRIES) {
      const candidate = this.entry(source.id, reference.nativeSessionId, history.entries[index]);
      const size = Buffer.byteLength(JSON.stringify(candidate), "utf8");
      if (entries.length && bytes + size > PAGE_BYTES) break;
      entries.push(candidate);
      bytes += size;
      index += 1;
    }

    let currentVersion: string;
    try {
      currentVersion = source.getGlobalSessionVersion
        ? await source.getGlobalSessionVersion(reference.nativeSessionId)
        : await source.getSessionVersion("", reference.nativeSessionId);
    } catch {
      currentVersion = history.version;
    }
    if (currentVersion !== history.version) {
      throw new Error("session history changed while it was read; restart the review");
    }

    return {
      entries,
      hasMore: index < history.entries.length,
      nextCursor: index < history.entries.length
        ? encodeCursor({ sourceId: source.id, nativeSessionId: reference.nativeSessionId, version: history.version, offset: index })
        : undefined,
      sourceVersion: history.version,
      incomplete: history.incomplete,
      available: true,
    };
  }

  async getSessionVersion(checkout: string, id: string, allowLegacy = false): Promise<string> { const ref = decodeSessionReference(id, allowLegacy); const source = this.source(ref.sourceId); const canonical = await this.requireCheckout(checkout); await this.assertVisible(source, canonical, ref.nativeSessionId); return source.getSessionVersion(canonical, ref.nativeSessionId); }
  decodeSession(id: string, allowLegacy = false): { sourceId: string; nativeSessionId: string } { return decodeSessionReference(id, allowLegacy); }
  decodeCall(id: string, allowLegacy = false): { sourceId: string; nativeSessionId: string; nativeCallId: string } { return decodeCallReference(id, allowLegacy); }
  decodeEntry(id: string): { sourceId: string; nativeSessionId: string } { const item = decodeEntryReference(id); return item; }

  private summary(sourceId: GuidanceHistorySource["id"], session: LocalSessionSummary, sourceVersion: string): GuidanceSessionSummary {
    return {
      id: sessionReference(sourceId, session.nativeSessionId), sourceId, client: session.client, title: session.title, directory: session.directory,
      parentId: session.parentId ? sessionReference(sourceId, session.parentId) : null, createdAt: session.createdAt, updatedAt: session.updatedAt, relatedChild: session.relatedChild, sourceVersion,
      available: session.available, unavailableReason: session.unavailableReason, limitations: session.limitations,
    };
  }
  private entry(sourceId: GuidanceHistorySource["id"], nativeSessionId: string, entry: LocalHistoryEntry): GuidanceHistoryEntry { return { ...entry, id: entryReference(sourceId, nativeSessionId, entry.nativeRecordId, entry.blockIndex ?? 0, entry.chunkIndex ?? 0), sessionId: sessionReference(sourceId, nativeSessionId), tool: entry.tool ? { ...entry.tool, callRef: callReference(sourceId, nativeSessionId, entry.tool.nativeCallId) } : undefined }; }
  private source(id: string): GuidanceHistorySource { const source = this.sources.find((candidate) => candidate.id === id); if (!source) throw new Error("history source is disabled or unavailable"); return source; }
  private async assertVisible(source: GuidanceHistorySource, checkout: string, nativeSessionId: string): Promise<void> { const session = (await source.listSessions(checkout)).find((candidate) => candidate.nativeSessionId === nativeSessionId); if (!session || session.available === false) throw new Error(session?.unavailableReason ?? "session is not associated with this checkout"); }
  private async requireCheckout(checkout: string): Promise<string> { try { return await realpath(checkout); } catch { throw new Error("selected checkout cannot be resolved for history access"); } }
  private missing(error: unknown): boolean { return error instanceof Error && /unavailable|ENOENT/.test(error.message); }
}

export { GuidanceHistoryCatalog as SessionHistoryCatalog };

