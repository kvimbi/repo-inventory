import { existsSync } from "node:fs";
import { lstat, readdir, realpath, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { asObject, asString, decodeClaudeRecords, getClaudeToolPayloadFromRecords, type ClaudeRecord } from "./claudeDecoder.ts";
import { findJsonlRecord, hashJsonl, readJsonl } from "./jsonl.ts";
import type { GuidanceHistorySource, LocalHistory, LocalSessionSummary } from "./source.ts";

interface ClaudeSession {
  id: string;
  path: string;
  title: string;
  directory?: string;
  client: "Claude Code" | "Claude Desktop Code";
  unavailableReason?: string;
  limitations?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class ClaudeHistorySource implements GuidanceHistorySource {
  readonly id = "claude" as const;
  private readonly configDir?: string;
  private readonly desktopSessionsPath?: string;

  constructor(configDir?: string, desktopSessionsPath?: string) { this.configDir = configDir; this.desktopSessionsPath = desktopSessionsPath; }

  async listSessions(checkout: string): Promise<LocalSessionSummary[]> {
    const canonicalCheckout = await this.canonicalPath(checkout);
    if (!canonicalCheckout) return [];
    const transcripts = await this.transcripts(canonicalCheckout);
    const desktop = await this.desktopMetadata(new Set(transcripts.map((session) => session.id)));
    const desktopByCliId = new Map(desktop.filter((item) => item.cliSessionId).map((item) => [item.cliSessionId!, item]));
    const summaries = transcripts.map((session) => {
      const metadata = desktopByCliId.get(session.id);
      return this.summary({ ...session, title: metadata?.title ?? session.title, client: metadata ? "Claude Desktop Code" : "Claude Code" });
    });
    return summaries;
  }

  async getHistory(checkout: string, nativeSessionId: string): Promise<LocalHistory> {
    const session = await this.requireSession(checkout, nativeSessionId);
    const result = await readJsonl(session.path);
    return { entries: decodeClaudeRecords(result.records), version: result.version, incomplete: result.incomplete };
  }

  async getToolPayload(checkout: string, nativeSessionId: string, nativeCallId: string, section: "input" | "output" | "error"): Promise<{ content?: string; available: boolean; version: string }> {
    const session = await this.requireSession(checkout, nativeSessionId);
    const transcript = await readJsonl(session.path);
    return getClaudeToolPayloadFromRecords(transcript.records, nativeCallId, section, transcript.version);
  }

  async getSessionVersion(checkout: string, nativeSessionId: string): Promise<string> { return hashJsonl((await this.requireSession(checkout, nativeSessionId)).path); }

  async listGlobalRecentSessions(limit: number): Promise<LocalSessionSummary[]> {
    const projects = resolve(this.root(), "projects");
    const results: ClaudeSession[] = [];

    if (existsSync(projects)) {
      let pEntries: Array<{ name: string; isDirectory: () => boolean }> = [];
      try {
        pEntries = await readdir(projects, { withFileTypes: true });
      } catch {
        pEntries = [];
      }
      for (const pEntry of pEntries) {
        if (!pEntry.isDirectory()) continue;
        const directory = resolve(projects, pEntry.name);
        const cache = await this.sessionCache(directory);
        if (!cache) continue;
        for (const item of Object.values(cache)) {
          const session = asObject(item.session);
          const path = asString(session?.file_path);
          const sessionId = asString(session?.actual_session_id) ?? asString(session?.session_id) ?? (path ? this.fileId(path) : undefined);
          if (!path || !sessionId || !this.isWithin(directory, path) || path.includes("/subagents/")) continue;
          const available = await this.isRegularFile(path);
          let dir = asString(session?.cwd) ?? asString(session?.project_path);
          if (!dir && available) {
            try {
              const cwdRecord = await findJsonlRecord(path, (rec) => Boolean(asString(asObject(rec)?.cwd)));
              dir = asString(asObject(cwdRecord)?.cwd);
            } catch {
              // ignore
            }
          }
          const stat = available ? await lstat(path).catch(() => undefined) : undefined;
          const updatedAt = stat ? new Date(stat.mtimeMs).toISOString() : undefined;
          const createdAt = stat ? new Date(stat.birthtimeMs || stat.mtimeMs).toISOString() : undefined;
          results.push({
            id: sessionId,
            path,
            title: asString(session?.summary) ?? "Untitled Claude session",
            directory: dir,
            client: "Claude Code",
            unavailableReason: available ? undefined : "Local transcript unavailable.",
            createdAt,
            updatedAt,
          });
        }
      }
    }

    const desktopRoot = this.desktopRoot();
    if (existsSync(desktopRoot)) {
      const desktopFiles = await this.jsonFiles(desktopRoot);
      const resultsById = new Map<string, ClaudeSession>();
      for (const s of results) {
        resultsById.set(s.id, s);
      }
      for (const deskPath of desktopFiles) {
        try {
          const data = asObject(JSON.parse(await readFile(deskPath, "utf8")) as unknown);
          if (!data) continue;
          const cliSessionId = asString(data.cliSessionId);
          const title = asString(data.title);
          const cwd = asString(data.cwd);
          if (cliSessionId && resultsById.has(cliSessionId)) {
            const existing = resultsById.get(cliSessionId)!;
            if (title) existing.title = title;
            if (cwd && !existing.directory) existing.directory = cwd;
            existing.client = "Claude Desktop Code";
          } else if (!cliSessionId) {
            const deskSessionId = asString(data.sessionId) ?? this.fileId(deskPath);
            const stat = await lstat(deskPath).catch(() => undefined);
            results.push({
              id: `desktop:${deskSessionId}`,
              path: deskPath,
              title: title ?? "Untitled Claude Desktop session",
              directory: cwd,
              client: "Claude Desktop Code",
              unavailableReason: "Local transcript unavailable.",
              createdAt: stat ? new Date(stat.birthtimeMs || stat.mtimeMs).toISOString() : undefined,
              updatedAt: stat ? new Date(stat.mtimeMs).toISOString() : undefined,
            });
          }
        } catch {
          // ignore
        }
      }
    }

    results.sort((a, b) => {
      const timeA = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      const timeB = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
      return timeB - timeA;
    });

    return results.slice(0, limit).map((s) => this.summary(s));
  }

  async getGlobalHistory(nativeSessionId: string): Promise<LocalHistory> {
    if (nativeSessionId.startsWith("desktop:")) {
      throw new Error("Local transcript unavailable.");
    }
    const session = await this.findGlobalSession(nativeSessionId);
    if (!session || !session.path || !(await this.isRegularFile(session.path))) {
      throw new Error("Local transcript unavailable.");
    }
    const result = await readJsonl(session.path);
    return { entries: decodeClaudeRecords(result.records), version: result.version, incomplete: result.incomplete };
  }

  async getGlobalSessionVersion(nativeSessionId: string): Promise<string> {
    if (nativeSessionId.startsWith("desktop:")) {
      throw new Error("Local transcript unavailable.");
    }
    const session = await this.findGlobalSession(nativeSessionId);
    if (!session || !session.path || !(await this.isRegularFile(session.path))) {
      throw new Error("Local transcript unavailable.");
    }
    return hashJsonl(session.path);
  }

  private async findGlobalSession(nativeSessionId: string): Promise<ClaudeSession | undefined> {
    const projects = resolve(this.root(), "projects");
    if (!existsSync(projects)) return undefined;
    let pEntries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      pEntries = await readdir(projects, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const pEntry of pEntries) {
      if (!pEntry.isDirectory()) continue;
      const directory = resolve(projects, pEntry.name);
      const cache = await this.sessionCache(directory);
      if (cache) {
        for (const item of Object.values(cache)) {
          const session = asObject(item.session);
          const path = asString(session?.file_path);
          const sessionId = asString(session?.actual_session_id) ?? asString(session?.session_id) ?? (path ? this.fileId(path) : undefined);
          if (sessionId === nativeSessionId && path && this.isWithin(directory, path)) {
            const available = await this.isRegularFile(path);
            return {
              id: sessionId,
              path,
              title: asString(session?.summary) ?? "Untitled Claude session",
              client: "Claude Code",
              unavailableReason: available ? undefined : "Local transcript unavailable.",
            };
          }
        }
      }
      const directPath = resolve(directory, `${nativeSessionId}.jsonl`);
      if (existsSync(directPath) && (await this.isRegularFile(directPath))) {
        return {
          id: nativeSessionId,
          path: directPath,
          title: "Untitled Claude session",
          client: "Claude Code",
        };
      }
    }
    return undefined;
  }

  private async requireSession(checkout: string, nativeSessionId: string): Promise<ClaudeSession> {
    if (nativeSessionId.startsWith("desktop:")) throw new Error("Local transcript unavailable.");
    const sessions = await this.transcripts(await this.canonicalPath(checkout) ?? checkout);
    const session = sessions.find((candidate) => candidate.id === nativeSessionId);
    if (!session) throw new Error("Claude session is not associated with this checkout");
    return session;
  }

  private async transcripts(checkout: string): Promise<ClaudeSession[]> {
    const projects = resolve(this.root(), "projects");
    if (!existsSync(projects)) throw new Error(`Claude history is unavailable at ${projects}`);
    const directory = resolve(projects, this.projectDirectoryName(checkout));
    const cache = await this.sessionCache(directory);
    if (!cache) return [];
    const results: ClaudeSession[] = [];
    for (const item of Object.values(cache)) {
      const session = asObject(item.session);
      const path = asString(session?.file_path);
      const sessionId = asString(session?.actual_session_id) ?? asString(session?.session_id) ?? (path ? this.fileId(path) : undefined);
      if (!path || !sessionId || !this.isWithin(directory, path) || path.includes("/subagents/")) continue;
      const available = await this.isRegularFile(path);
      results.push({ id: sessionId, path, title: asString(session?.summary) ?? "Untitled Claude session", directory: checkout, client: "Claude Code", unavailableReason: available ? undefined : "Local transcript unavailable." });
    }
    return results;
  }

  private async desktopMetadata(sessionIds: Set<string>): Promise<Array<{ cliSessionId?: string; title?: string }>> {
    const root = this.desktopRoot();
    if (!existsSync(root)) return [];
    const metadata: Array<{ cliSessionId?: string; title?: string; cwd?: string }> = [];
    for (const path of await this.jsonFiles(root)) {
      try {
        const data = asObject(JSON.parse(await readFile(path, "utf8")) as unknown);
        if (!data || !sessionIds.has(asString(data.cliSessionId) ?? "")) continue;
        metadata.push({ cliSessionId: asString(data.cliSessionId), title: asString(data.title) });
      } catch { /* A changing Desktop metadata file is unavailable for this discovery pass. */ }
    }
    return metadata;
  }

  private summary(session: ClaudeSession): LocalSessionSummary {
    return {
      nativeSessionId: session.id,
      title: session.title,
      directory: session.directory,
      parentId: null,
      relatedChild: false,
      client: session.client,
      decoderVersion: "claude-jsonl-v1",
      available: !session.unavailableReason,
      unavailableReason: session.unavailableReason,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      limitations: session.limitations ?? "Branch records retain parent UUIDs; this preview preserves stored order rather than claiming a reconstructed execution branch.",
    };
  }

  private root(): string { return this.configDir?.trim() || process.env.CLAUDE_CONFIG_DIR || resolve(homedir(), ".claude"); }
  private desktopRoot(): string { return this.desktopSessionsPath?.trim() || resolve(homedir(), "Library/Application Support/Claude/claude-code-sessions"); }
  private fileId(path: string): string { return path.slice(path.lastIndexOf("/") + 1).replace(/\.jsonl$/, ""); }
  private projectDirectoryName(checkout: string): string { return `-${checkout.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-/, "")}`; }
  private isWithin(root: string, path: string): boolean { const target = resolve(path); return target === root || target.startsWith(`${root}/`); }
  private async isRegularFile(path: string): Promise<boolean> { try { return (await lstat(path)).isFile(); } catch { return false; } }
  private async canonicalPath(path: string): Promise<string | undefined> { try { return await realpath(path); } catch { return undefined; } }
  private async jsonFiles(root: string): Promise<string[]> { return this.files(root, ".json"); }
  private async sessionCache(directory: string): Promise<Record<string, ClaudeRecord> | undefined> {
    try {
      const parsed = asObject(JSON.parse(await readFile(resolve(directory, ".session_cache.json"), "utf8")) as unknown);
      const entries = asObject(parsed?.entries);
      if (!entries) return undefined;
      return Object.fromEntries(Object.entries(entries).flatMap(([path, value]) => {
        const item = asObject(value);
        return item ? [[path, item]] : [];
      }));
    } catch { return undefined; }
  }
  private async files(root: string, extension: string): Promise<string[]> {
    const found: string[] = []; const pending = [root];
    while (pending.length) { const directory = pending.pop()!; let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) { const path = resolve(directory, entry.name); if (entry.isDirectory()) pending.push(path); else if (entry.isFile() && entry.name.endsWith(extension)) found.push(path); }
    }
    return found;
  }
}
