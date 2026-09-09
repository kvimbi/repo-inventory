import type { Inventory, Annotation, Project, ScanProgress, GuidanceHistoryPage, GuidanceReview, GuidanceReviewInfo, GuidanceSessionList, GuidanceToolPayload, AgentToolId, AgentToolSummary, AgentToolDetails, AgentResourcePreview, OpenConfigurationRequest, OpenConfigurationResult } from "../core/types.ts";
import type { AnnotationPatch, ScriptResult, DocFile, DocContent, CodingAgent, CodingRun } from "./apiClient.ts";

export interface ChatStreamEvent {
  type: "text" | "reasoning" | "tool-call" | "tool-result" | "error";
  text?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
}

export interface AppConfig {
  root: string;
  roots: string[];
  aiProvider?: "gemini" | "bedrock";
  geminiApiKey?: string;
  hasGeminiApiKey: boolean;
  bedrockApiKey?: string;
  hasBedrockApiKey: boolean;
  bedrockRegion?: string;
  chatProvider?: "gemini" | "bedrock";
  chatModel?: string;
  guidanceReviewProvider?: "gemini" | "bedrock";
  allowedRootBashPatterns?: string[];
  guidanceReviewModel?: string;
  openCodeDatabasePath?: string;
  claudeConfigDir?: string;
  claudeDesktopSessionsPath?: string;
  claudeCoworkSessionsPath?: string;
  codexHome?: string;
  guidanceHistorySources?: Array<"opencode" | "claude" | "cowork" | "codex">;
}

export interface ElectronAPI {
  getHealth: () => Promise<{ ok: boolean; scannedAt: string | null; scanning: boolean }>;
  getInventory: () => Promise<Inventory>;
  quickRefresh: () => Promise<Inventory>;
  runScan: (fetchRemotes: boolean) => Promise<Inventory>;
  onScanProgress?: (callback: (progress: ScanProgress) => void) => () => void;
  saveAnnotation: (id: string, patch: AnnotationPatch) => Promise<{ annotation: Annotation; project: Project | null }>;
  saveBatchAnnotations: (
    ids: string[],
    patch: AnnotationPatch,
  ) => Promise<{ annotations: Record<string, Annotation>; inventory: Inventory | null; projects: Project[] }>;
  generateScript: (action: string, ids: string[]) => Promise<ScriptResult>;
  getDocFiles: (id: string) => Promise<DocFile[]>;
  getDocContent: (id: string, file: string) => Promise<DocContent>;
  openInIde: (id: string, ide: string) => Promise<void>;
  fetchProject: (id: string) => Promise<{ ok: boolean; inventory?: Inventory; project: Project | null }>;
  scanProject: (id: string, fetchRemotes?: boolean) => Promise<{ ok: boolean; inventory: Inventory; project: Project }>;
  executeAction: (id: string, action: string) => Promise<{ ok: boolean; inventory: Inventory; project: Project }>;
  listGuidanceSessions: (projectId: string) => Promise<GuidanceSessionList>;
  getGuidanceReviewInfo: (projectId: string) => Promise<GuidanceReviewInfo>;
  getGuidanceHistory: (projectId: string, sessionId: string, cursor?: string) => Promise<GuidanceHistoryPage>;
  getGuidanceToolPayload: (projectId: string, callRef: string, section: "input" | "output" | "error", cursor?: string) => Promise<GuidanceToolPayload>;
  startGuidanceReview: (projectId: string, sessionIds: string[]) => Promise<GuidanceReview>;
  getGuidanceReview: (reviewId: string) => Promise<GuidanceReview>;
  cancelGuidanceReview: (reviewId: string) => Promise<GuidanceReview>;
  applyGuidanceReview: (reviewId: string, editIds: string[]) => Promise<GuidanceReview>;
  getCodingAgents: () => Promise<CodingAgent[]>;
  startCodingRun: (projectId: string, agent: CodingAgent["id"], prompt: string) => Promise<CodingRun>;
  startBashRun: (projectId: string, command: string) => Promise<CodingRun>;
  stopCodingRun: (id: string) => Promise<CodingRun>;
  onCodingRunEvent: (id: string, callback: (run: CodingRun) => void) => () => void;
  streamChat: (
    request: { messages: Array<{ role: "user" | "assistant"; content: string }>; projectId?: string; preferredAgent?: string },
    onEvent: (event: ChatStreamEvent) => void,
    onDone: (error?: string) => void,
  ) => () => void;
  getConfig: () => Promise<AppConfig>;
  saveConfig: (updates: {
    roots?: string[];
    aiProvider?: "gemini" | "bedrock";
    geminiApiKey?: string;
    bedrockApiKey?: string;
    bedrockRegion?: string;
    chatProvider?: "gemini" | "bedrock";
    chatModel?: string;
    guidanceReviewProvider?: "gemini" | "bedrock";
    allowedRootBashPatterns?: string[];
    guidanceReviewModel?: string;
    openCodeDatabasePath?: string;
    claudeConfigDir?: string;
    claudeDesktopSessionsPath?: string;
    claudeCoworkSessionsPath?: string;
    codexHome?: string;
    guidanceHistorySources?: Array<"opencode" | "claude" | "cowork" | "codex">;
  }) => Promise<AppConfig>;
  selectDirectory: () => Promise<string | null>;
  onOpenSettings?: (callback: () => void) => () => void;
  agentTools: {
    list: () => Promise<AgentToolSummary[]>;
    refresh: () => Promise<AgentToolSummary[]>;
    getDetails: (id: AgentToolId) => Promise<AgentToolDetails | null>;
    readResource: (ref: string) => Promise<AgentResourcePreview>;
    openConfiguration: (req: OpenConfigurationRequest) => Promise<OpenConfigurationResult>;
    readSessionTranscript?: (id: string, cursor?: string) => Promise<GuidanceHistoryPage>;
  };
  readAgentSessionTranscript?: (id: string, cursor?: string) => Promise<GuidanceHistoryPage>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && typeof window.electronAPI !== "undefined";
}
