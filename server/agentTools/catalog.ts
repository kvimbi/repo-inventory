import type {
  AgentResourcePreview,
  AgentToolDetails,
  AgentToolId,
  AgentToolSummary,
  GuidanceHistoryPage,
  OpenConfigurationResult,
} from "../../core/types.ts";
import { MAX_SESSIONS_PER_TOOL } from "./bounds.ts";
import { discoverTools } from "./discovery.ts";
import { openConfiguration, type SpawnFunction } from "./opener.ts";
import { readResource } from "./resources.ts";
import {
  SessionHistoryCatalog,
  OpenCodeHistorySource,
  ClaudeHistorySource,
  CoworkHistorySource,
  CodexHistorySource,
} from "../sessionHistory/index.ts";

export interface CatalogItemRef {
  id: string;
  toolId: AgentToolId;
  name: string;
  path: string;
  canonicalPath: string;
  kind: "skill" | "subagent" | "instruction" | "configuration";
}

export class AgentToolsCatalog {
  private cache: Map<AgentToolId, AgentToolDetails> | null = null;
  private inFlight: Promise<Map<AgentToolId, AgentToolDetails>> | null = null;
  private resourceIndex: Map<string, CatalogItemRef> = new Map();
  private discoverFn: () => Promise<Map<AgentToolId, AgentToolDetails>>;
  private historyCatalog: SessionHistoryCatalog;
  private getKnownProjects?: () => Promise<Array<{ id: string; name: string; path: string }>>;
  private spawnFn?: SpawnFunction;

  constructor(
    discoverFn?: () => Promise<Map<AgentToolId, AgentToolDetails>>,
    historyCatalog?: SessionHistoryCatalog,
    getKnownProjects?: () => Promise<Array<{ id: string; name: string; path: string }>>,
    spawnFn?: SpawnFunction,
  ) {
    this.discoverFn = discoverFn ?? discoverTools;
    this.historyCatalog =
      historyCatalog ??
      new SessionHistoryCatalog([
        new OpenCodeHistorySource(),
        new ClaudeHistorySource(),
        new CoworkHistorySource(),
        new CodexHistorySource(),
      ]);
    this.getKnownProjects = getKnownProjects;
    this.spawnFn = spawnFn;
  }

  private ensureDiscovered(): Promise<Map<AgentToolId, AgentToolDetails>> {
    if (this.cache) {
      return Promise.resolve(this.cache);
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.discoverFn()
      .then((map) => {
        this.cache = map;
        this.buildResourceIndex(map);
        this.inFlight = null;
        return map;
      })
      .catch((err) => {
        this.inFlight = null;
        throw err;
      });
    return this.inFlight;
  }

  private buildResourceIndex(map: Map<AgentToolId, AgentToolDetails>): void {
    this.resourceIndex.clear();
    for (const details of map.values()) {
      for (const skill of details.skills.items) {
        this.resourceIndex.set(skill.id, {
          id: skill.id,
          toolId: skill.toolId,
          name: skill.name,
          path: skill.path,
          canonicalPath: skill.canonicalId,
          kind: "skill",
        });
      }
      for (const subagent of details.subagents.items) {
        this.resourceIndex.set(subagent.id, {
          id: subagent.id,
          toolId: subagent.toolId,
          name: subagent.name,
          path: subagent.path,
          canonicalPath: subagent.canonicalId,
          kind: "subagent",
        });
      }
      for (const inst of details.instructions.items) {
        this.resourceIndex.set(inst.id, {
          id: inst.id,
          toolId: inst.toolId,
          name: inst.name,
          path: inst.path,
          canonicalPath: inst.canonicalId,
          kind: "instruction",
        });
      }
      for (const cfg of details.configurations) {
        this.resourceIndex.set(cfg.id, {
          id: cfg.id,
          toolId: cfg.toolId,
          name: cfg.label,
          path: cfg.path,
          canonicalPath: cfg.canonicalPath,
          kind: "configuration",
        });
      }
    }
  }

  async lookupRef(ref: string): Promise<CatalogItemRef | null> {
    await this.ensureDiscovered();
    return this.resourceIndex.get(ref) ?? null;
  }

  async listTools(): Promise<AgentToolSummary[]> {
    const map = await this.ensureDiscovered();
    return Array.from(map.values()).map((d) => d.summary);
  }

  async getToolDetails(toolId: AgentToolId): Promise<AgentToolDetails | null> {
    const map = await this.ensureDiscovered();
    const details = map.get(toolId);
    if (!details) return null;
    const knownProjects = this.getKnownProjects ? await this.getKnownProjects() : [];
    const recentSessions = await this.historyCatalog.listGlobalRecentSessions(toolId, MAX_SESSIONS_PER_TOOL, knownProjects);
    return {
      ...details,
      recentSessions,
    };
  }

  async readSessionTranscript(sessionId: string, cursor?: string): Promise<GuidanceHistoryPage> {
    return this.historyCatalog.getGlobalHistory(sessionId, cursor);
  }

  async refresh(): Promise<AgentToolSummary[]> {
    this.cache = null;
    this.inFlight = null;
    this.resourceIndex.clear();
    return this.listTools();
  }

  async readResource(ref: string): Promise<AgentResourcePreview> {
    await this.ensureDiscovered();
    return readResource(this, ref);
  }

  async openConfiguration(ref: string, action: "editor" | "reveal", ideOrSpawn?: string | SpawnFunction, spawnFn?: SpawnFunction): Promise<OpenConfigurationResult> {
    await this.ensureDiscovered();
    return openConfiguration(this, ref, action, ideOrSpawn, spawnFn ?? this.spawnFn);
  }
}
