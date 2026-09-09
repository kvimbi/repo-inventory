import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { asObject, asString, decodeClaudeRecords, getClaudeToolPayloadFromRecords, type ClaudeRecord } from "./claudeDecoder.ts";
import { findJsonlRecord, hashJsonl, readJsonl } from "./jsonl.ts";
import type { GuidanceHistorySource, LocalHistory, LocalSessionSummary } from "./source.ts";

export const COWORK_DECODER_VERSION = "claude-cowork-v1";

interface CoworkMetadata {
  sessionId: string;
  cliSessionId?: string;
  title: string;
  cwd?: string;
  userSelectedFolders: string[];
  createdAt?: string;
  updatedAt?: string;
  isArchived?: boolean;
}

interface CoworkSession {
  nativeSessionId: string;
  account: string;
  organization: string;
  metadataSessionId: string;
  metadata: CoworkMetadata;
  path?: string;
  available: boolean;
  unavailableReason?: string;
  limitations?: string;
}

export class CoworkHistorySource implements GuidanceHistorySource {
  readonly id = "cowork" as const;
  private readonly sessionsPath?: string;

  constructor(sessionsPath?: string) {
    this.sessionsPath = sessionsPath;
  }

  async listSessions(checkout: string): Promise<LocalSessionSummary[]> {
    const root = this.resolveRoot();
    if (!root) throw new Error("Claude Cowork sessions directory is not configured for this platform.");
    if (!existsSync(root)) throw new Error(`Claude Cowork history is unavailable at ${root}`);

    const canonicalCheckout = await this.canonicalPath(checkout);
    if (!canonicalCheckout) return [];

    const sessions = await this.discoverSessions(root, canonicalCheckout);
    return sessions.map((session) => this.summary(session, canonicalCheckout));
  }

  async getHistory(checkout: string, nativeSessionId: string): Promise<LocalHistory> {
    const session = await this.requireSession(checkout, nativeSessionId);
    if (!session.path || !session.available) {
      throw new Error(session.unavailableReason ?? "Local transcript unavailable.");
    }
    const transcript = await readJsonl(session.path);
    const version = this.compositeVersion(transcript.version, session.metadata);
    return {
      entries: decodeClaudeRecords(transcript.records),
      version,
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
    if (!session.path || !session.available) {
      throw new Error(session.unavailableReason ?? "Local transcript unavailable.");
    }
    const transcript = await readJsonl(session.path);
    const version = this.compositeVersion(transcript.version, session.metadata);
    return getClaudeToolPayloadFromRecords(transcript.records, nativeCallId, section, version);
  }

  async getSessionVersion(checkout: string, nativeSessionId: string): Promise<string> {
    const session = await this.requireSession(checkout, nativeSessionId);
    if (!session.path || !session.available) {
      throw new Error(session.unavailableReason ?? "Local transcript unavailable.");
    }
    const transcriptHash = await hashJsonl(session.path);
    return this.compositeVersion(transcriptHash, session.metadata);
  }

  async listGlobalRecentSessions(limit: number): Promise<LocalSessionSummary[]> {
    const root = this.resolveRoot();
    if (!root || !existsSync(root)) return [];

    const sessions: LocalSessionSummary[] = [];
    let accounts: string[] = [];
    try {
      accounts = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name);
    } catch {
      return [];
    }

    for (const account of accounts) {
      const accountPath = resolve(root, account);
      if (!this.isWithin(root, accountPath)) continue;

      let orgs: string[] = [];
      try {
        orgs = (await readdir(accountPath, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => entry.name);
      } catch {
        continue;
      }

      for (const organization of orgs) {
        const orgPath = resolve(accountPath, organization);
        if (!this.isWithin(root, orgPath)) continue;

        let entries;
        try {
          entries = await readdir(orgPath, { withFileTypes: true });
        } catch {
          continue;
        }

        const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name.startsWith("local_"));
        for (const jsonFile of jsonFiles) {
          const metaPath = resolve(orgPath, jsonFile.name);
          if (!this.isWithin(root, metaPath)) continue;

          const metadata = await this.readMetadataFile(metaPath);
          if (!metadata) continue;

          const metadataSessionId = jsonFile.name.slice(0, -".json".length);
          const session = await this.resolveSessionTranscript(root, account, organization, metadataSessionId, metadata);
          const fallbackDir = metadata.userSelectedFolders[0] ?? metadata.cwd ?? "";
          sessions.push(this.summary(session, fallbackDir));
        }
      }
    }

    sessions.sort((a, b) => {
      const timeA = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      const timeB = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
      return timeB - timeA;
    });

    return sessions.slice(0, limit);
  }

  async getGlobalHistory(nativeSessionId: string): Promise<LocalHistory> {
    const session = await this.resolveGlobalCoworkSession(nativeSessionId);
    if (!session.path || !session.available) {
      throw new Error(session.unavailableReason ?? "Local transcript unavailable.");
    }
    const transcript = await readJsonl(session.path);
    const version = this.compositeVersion(transcript.version, session.metadata);
    return {
      entries: decodeClaudeRecords(transcript.records),
      version,
      incomplete: transcript.incomplete,
    };
  }

  async getGlobalSessionVersion(nativeSessionId: string): Promise<string> {
    const session = await this.resolveGlobalCoworkSession(nativeSessionId);
    if (!session.path || !session.available) {
      throw new Error(session.unavailableReason ?? "Local transcript unavailable.");
    }
    const transcriptHash = await hashJsonl(session.path);
    return this.compositeVersion(transcriptHash, session.metadata);
  }

  private async resolveGlobalCoworkSession(nativeSessionId: string): Promise<CoworkSession> {
    const root = this.resolveRoot();
    if (!root || !existsSync(root)) throw new Error("Local transcript unavailable.");

    const parts = nativeSessionId.split(":");
    if (parts.length < 3) throw new Error("Local transcript unavailable.");
    const [account, organization, ...rest] = parts;
    const metadataSessionId = rest.join(":");

    const sessionDir = resolve(root, account, organization, metadataSessionId);
    const metaPath = resolve(root, account, organization, `${metadataSessionId}.json`);
    if (!this.isWithin(root, metaPath) || !this.isWithin(root, sessionDir)) {
      throw new Error("Local transcript unavailable.");
    }
    if (!existsSync(metaPath)) {
      throw new Error("Local transcript unavailable.");
    }

    const metadata = await this.readMetadataFile(metaPath);
    if (!metadata) throw new Error("Local transcript unavailable.");

    return this.resolveSessionTranscript(root, account, organization, metadataSessionId, metadata);
  }

  private resolveRoot(): string | undefined {
    return this.sessionsPath?.trim() || (process.platform === "darwin"
      ? resolve(homedir(), "Library/Application Support/Claude/local-agent-mode-sessions")
      : undefined);
  }

  private compositeVersion(transcriptHash: string, metadata: CoworkMetadata): string {
    const identity = {
      sessionId: metadata.sessionId,
      cliSessionId: metadata.cliSessionId,
      userSelectedFolders: metadata.userSelectedFolders,
      cwd: metadata.cwd,
      decoderVersion: COWORK_DECODER_VERSION,
    };
    const metaHash = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    return createHash("sha256").update(transcriptHash).update(metaHash).digest("hex");
  }

  private summary(session: CoworkSession, checkout: string): LocalSessionSummary {
    return {
      nativeSessionId: session.nativeSessionId,
      title: session.metadata.title,
      directory: session.metadata.userSelectedFolders.length === 1 ? session.metadata.userSelectedFolders[0] : checkout,
      parentId: null,
      relatedChild: false,
      client: "Claude Cowork (local)",
      createdAt: session.metadata.createdAt,
      updatedAt: session.metadata.updatedAt,
      decoderVersion: COWORK_DECODER_VERSION,
      available: session.available,
      unavailableReason: session.unavailableReason,
      limitations: session.limitations ?? "Branch records retain parent UUIDs; this preview preserves stored order rather than claiming a reconstructed execution branch.",
    };
  }

  private async requireSession(checkout: string, nativeSessionId: string): Promise<CoworkSession> {
    const root = this.resolveRoot();
    if (!root || !existsSync(root)) throw new Error("Claude Cowork history is unavailable");
    const canonicalCheckout = await this.canonicalPath(checkout);
    if (!canonicalCheckout) throw new Error("selected checkout cannot be resolved for history access");

    const parts = nativeSessionId.split(":");
    if (parts.length < 3) throw new Error("invalid Cowork session ID format");
    const [account, organization, ...rest] = parts;
    const metadataSessionId = rest.join(":");

    const sessionDir = resolve(root, account, organization, metadataSessionId);
    const metaPath = resolve(root, account, organization, `${metadataSessionId}.json`);
    if (!this.isWithin(root, metaPath) || !this.isWithin(root, sessionDir)) {
      throw new Error("Cowork session path escapes root");
    }
    if (!existsSync(metaPath)) {
      throw new Error("Cowork session is not associated with this checkout");
    }

    const metadata = await this.readMetadataFile(metaPath);
    if (!metadata) throw new Error("Cowork metadata is invalid or unavailable");

    const canonicalFolders: string[] = [];
    for (const folder of metadata.userSelectedFolders) {
      const canonical = await this.canonicalPath(folder);
      if (canonical) canonicalFolders.push(canonical);
    }

    if (canonicalFolders.length === 0) {
      throw new Error("Cowork session without selected folders is excluded from automatic project association.");
    }
    if (canonicalFolders.length > 1) {
      throw new Error("Multi-folder Cowork sessions are excluded from automatic project association.");
    }
    const singleFolder = canonicalFolders[0]!;
    if (singleFolder !== canonicalCheckout) {
      if (canonicalCheckout.startsWith(`${singleFolder}${sep}`)) {
        throw new Error("Ancestor-folder Cowork sessions are excluded from automatic project association.");
      }
      throw new Error("Cowork session is not associated with this checkout");
    }

    return this.resolveSessionTranscript(root, account, organization, metadataSessionId, metadata);
  }

  private async discoverSessions(root: string, canonicalCheckout: string): Promise<CoworkSession[]> {
    const sessions: CoworkSession[] = [];
    let accounts: string[] = [];
    try {
      accounts = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name);
    } catch {
      return [];
    }

    for (const account of accounts) {
      const accountPath = resolve(root, account);
      if (!this.isWithin(root, accountPath)) continue;

      let orgs: string[] = [];
      try {
        orgs = (await readdir(accountPath, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => entry.name);
      } catch {
        continue;
      }

      for (const organization of orgs) {
        const orgPath = resolve(accountPath, organization);
        if (!this.isWithin(root, orgPath)) continue;

        let entries;
        try {
          entries = await readdir(orgPath, { withFileTypes: true });
        } catch {
          continue;
        }

        const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name.startsWith("local_"));
        for (const jsonFile of jsonFiles) {
          const metaPath = resolve(orgPath, jsonFile.name);
          if (!this.isWithin(root, metaPath)) continue;

          const metadata = await this.readMetadataFile(metaPath);
          if (!metadata) continue;

          const metadataSessionId = jsonFile.name.slice(0, -".json".length);
          const canonicalFolders: string[] = [];
          for (const folder of metadata.userSelectedFolders) {
            const canonical = await this.canonicalPath(folder);
            if (canonical) canonicalFolders.push(canonical);
          }

          const nativeSessionId = `${account}:${organization}:${metadataSessionId}`;

          // Project association rules:
          if (canonicalFolders.length === 0) {
            // Absent folder: excluded from automatic selection
            continue;
          }

          if (canonicalFolders.length > 1) {
            // Multi-folder session: if it includes checkout, report as unavailable with diagnostic
            if (canonicalFolders.includes(canonicalCheckout)) {
              sessions.push({
                nativeSessionId,
                account,
                organization,
                metadataSessionId,
                metadata,
                available: false,
                unavailableReason: "Multi-folder Cowork sessions are excluded from automatic project association.",
              });
            }
            continue;
          }

          const singleFolder = canonicalFolders[0]!;
          if (singleFolder === canonicalCheckout) {
            // Exact single-folder match!
            const session = await this.resolveSessionTranscript(root, account, organization, metadataSessionId, metadata);
            sessions.push(session);
          } else if (canonicalCheckout.startsWith(`${singleFolder}${sep}`)) {
            // Ancestor folder match: report as unavailable with diagnostic
            sessions.push({
              nativeSessionId,
              account,
              organization,
              metadataSessionId,
              metadata,
              available: false,
              unavailableReason: "Ancestor-folder Cowork sessions are excluded from automatic project association.",
            });
          }
        }
      }
    }

    return sessions;
  }

  private async resolveSessionTranscript(
    root: string,
    account: string,
    organization: string,
    metadataSessionId: string,
    metadata: CoworkMetadata,
  ): Promise<CoworkSession> {
    const nativeSessionId = `${account}:${organization}:${metadataSessionId}`;
    if (!metadata.cliSessionId) {
      return {
        nativeSessionId,
        account,
        organization,
        metadataSessionId,
        metadata,
        available: false,
        unavailableReason: "Local transcript unavailable.",
      };
    }

    const sessionDir = resolve(root, account, organization, metadataSessionId);
    if (!this.isWithin(root, sessionDir)) {
      return {
        nativeSessionId,
        account,
        organization,
        metadataSessionId,
        metadata,
        available: false,
        unavailableReason: "Local transcript unavailable.",
      };
    }

    const projectsDir = resolve(sessionDir, ".claude/projects");
    if (!existsSync(projectsDir) || !this.isWithin(root, projectsDir)) {
      return {
        nativeSessionId,
        account,
        organization,
        metadataSessionId,
        metadata,
        available: false,
        unavailableReason: "Local transcript unavailable.",
      };
    }

    // Find transcript matching cliSessionId.jsonl inside .claude/projects/
    const matchingPaths: string[] = [];
    try {
      const projectDirs = await readdir(projectsDir, { withFileTypes: true });
      for (const pDir of projectDirs) {
        if (!pDir.isDirectory()) continue;
        const candidate = resolve(projectsDir, pDir.name, `${metadata.cliSessionId}.jsonl`);
        if (this.isWithin(root, candidate) && existsSync(candidate) && (await this.isRegularFile(candidate))) {
          matchingPaths.push(candidate);
        }
      }
    } catch {
      return {
        nativeSessionId,
        account,
        organization,
        metadataSessionId,
        metadata,
        available: false,
        unavailableReason: "Local transcript unavailable.",
      };
    }

    if (matchingPaths.length === 0) {
      return {
        nativeSessionId,
        account,
        organization,
        metadataSessionId,
        metadata,
        available: false,
        unavailableReason: "Local transcript unavailable.",
      };
    }

    if (matchingPaths.length > 1) {
      return {
        nativeSessionId,
        account,
        organization,
        metadataSessionId,
        metadata,
        available: false,
        unavailableReason: "Ambiguous transcript linkage.",
      };
    }

    const transcriptPath = matchingPaths[0]!;

    // Linkage verification: inspect early record to ensure record sessionId matches cliSessionId
    try {
      const firstRecord = asObject(await findJsonlRecord(transcriptPath, (record) => Boolean(asObject(record)?.sessionId)));
      if (firstRecord) {
        const recSessionId = asString(firstRecord.sessionId);
        if (recSessionId && recSessionId !== metadata.cliSessionId) {
          return {
            nativeSessionId,
            account,
            organization,
            metadataSessionId,
            metadata,
            path: transcriptPath,
            available: false,
            unavailableReason: "Transcript record session ID does not match metadata.",
          };
        }
      }
    } catch {
      // If reading fails, it remains unavailable
      return {
        nativeSessionId,
        account,
        organization,
        metadataSessionId,
        metadata,
        available: false,
        unavailableReason: "Local transcript unavailable.",
      };
    }

    return {
      nativeSessionId,
      account,
      organization,
      metadataSessionId,
      metadata,
      path: transcriptPath,
      available: true,
    };
  }

  private async readMetadataFile(path: string): Promise<CoworkMetadata | undefined> {
    try {
      const parsed = asObject(JSON.parse(await readFile(path, "utf8")) as unknown);
      if (!parsed) return undefined;

      const sessionId = asString(parsed.sessionId) ?? "";
      if (!sessionId) return undefined;

      const cliSessionId = asString(parsed.cliSessionId);
      const title = asString(parsed.title) ?? "Untitled Cowork session";
      const cwd = asString(parsed.cwd);
      const rawFolders = Array.isArray(parsed.userSelectedFolders) ? parsed.userSelectedFolders : [];
      const userSelectedFolders = rawFolders.filter((f): f is string => typeof f === "string");
      const createdAt = typeof parsed.createdAt === "number" ? new Date(parsed.createdAt).toISOString() : asString(parsed.createdAt);
      const updatedAt = typeof parsed.lastActivityAt === "number" ? new Date(parsed.lastActivityAt).toISOString() : asString(parsed.lastActivityAt);
      const isArchived = parsed.isArchived === true;

      return {
        sessionId,
        cliSessionId,
        title,
        cwd,
        userSelectedFolders,
        createdAt,
        updatedAt,
        isArchived,
      };
    } catch {
      return undefined;
    }
  }

  private isWithin(root: string, path: string): boolean {
    const target = resolve(path);
    return target === root || target.startsWith(`${root}${sep}`);
  }

  private async isRegularFile(path: string): Promise<boolean> {
    try {
      return (await lstat(path)).isFile();
    } catch {
      return false;
    }
  }

  private async canonicalPath(path: string): Promise<string | undefined> {
    try {
      return await realpath(path);
    } catch {
      return undefined;
    }
  }
}
