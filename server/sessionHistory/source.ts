import type { GuidanceHistoryEntry, GuidanceSessionSummary } from "../../core/types.ts";

export interface LocalSessionSummary extends Omit<GuidanceSessionSummary, "id" | "sourceId" | "sourceVersion"> {
  nativeSessionId: string;
  decoderVersion: string;
}

export interface LocalHistoryEntry extends Omit<GuidanceHistoryEntry, "id" | "sessionId" | "tool"> {
  nativeRecordId: string;
  blockIndex?: number;
  chunkIndex?: number;
  tool?: Omit<NonNullable<GuidanceHistoryEntry["tool"]>, "callRef"> & { nativeCallId: string };
}

export interface LocalHistory {
  entries: LocalHistoryEntry[];
  version: string;
  incomplete?: string;
}

export interface GuidanceHistorySource {
  readonly id: "opencode" | "claude" | "cowork" | "codex";
  listSessions(checkout: string): Promise<LocalSessionSummary[]>;
  getHistory(checkout: string, nativeSessionId: string): Promise<LocalHistory>;
  getToolPayload(checkout: string, nativeSessionId: string, nativeCallId: string, section: "input" | "output" | "error"): Promise<{ content?: string; available: boolean; version: string }>;
  getSessionVersion(checkout: string, nativeSessionId: string): Promise<string>;
  listGlobalRecentSessions?(limit: number): Promise<LocalSessionSummary[]>;
  getGlobalHistory?(nativeSessionId: string): Promise<LocalHistory>;
  getGlobalSessionVersion?(nativeSessionId: string): Promise<string>;
}
