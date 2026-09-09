import type {
  AgentToolId,
  ConfigurationReference,
  GlobalResource,
  McpServerDeclaration,
  ToolCapabilityResult,
} from "../../../core/types.ts";

export interface AgentToolAdapter {
  toolId: AgentToolId;
  discoverSkills(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>>;
  discoverSubagents(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>>;
  discoverInstructions(roots: string[], home?: string): Promise<ToolCapabilityResult<GlobalResource>>;
  discoverConfigurations(roots: string[], home?: string): Promise<ConfigurationReference[]>;
  discoverMcpServers(roots: string[], configs: ConfigurationReference[]): Promise<ToolCapabilityResult<McpServerDeclaration>>;
}
