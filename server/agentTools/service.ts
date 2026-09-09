import type {
  AgentResourcePreview,
  AgentToolDetails,
  AgentToolId,
  AgentToolSummary,
  GuidanceHistoryPage,
  OpenConfigurationResult,
} from "../../core/types.ts";
import { AgentToolsCatalog } from "./catalog.ts";
import type { SpawnFunction } from "./opener.ts";

export class AgentToolsService {
  private catalog: AgentToolsCatalog;

  constructor(catalog?: AgentToolsCatalog) {
    this.catalog = catalog ?? new AgentToolsCatalog();
  }

  async listTools(): Promise<AgentToolSummary[]> {
    return this.catalog.listTools();
  }

  async getToolDetails(toolId: AgentToolId): Promise<AgentToolDetails | null> {
    return this.catalog.getToolDetails(toolId);
  }

  async refresh(): Promise<AgentToolSummary[]> {
    return this.catalog.refresh();
  }

  async readResource(ref: string): Promise<AgentResourcePreview> {
    return this.catalog.readResource(ref);
  }

  async openConfiguration(
    ref: string,
    action: "editor" | "reveal",
    ideOrSpawn?: string | SpawnFunction,
    spawnFn?: SpawnFunction,
  ): Promise<OpenConfigurationResult> {
    return this.catalog.openConfiguration(ref, action, ideOrSpawn, spawnFn);
  }

  async readSessionTranscript(sessionId: string, cursor?: string): Promise<GuidanceHistoryPage> {
    return this.catalog.readSessionTranscript(sessionId, cursor);
  }
}
