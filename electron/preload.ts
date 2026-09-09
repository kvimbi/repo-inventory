import { contextBridge, ipcRenderer } from "electron";
import type { AnnotationPatch, ScriptResult, DocFile, DocContent, CodingAgent, CodingRun } from "../web/apiClient.ts";
import type { Inventory, Annotation, Project, ScanProgress, AgentToolId, OpenConfigurationRequest } from "../core/types.ts";
import type { GuidanceHistoryPage, GuidanceReview, GuidanceReviewInfo, GuidanceSessionList, GuidanceToolPayload } from "../core/types.ts";
import type { ChatStreamEvent, ElectronAPI } from "../web/electronBridge.ts";

const electronAPI: ElectronAPI = {
  getHealth: () => ipcRenderer.invoke("inventory:getHealth"),
  getInventory: () => ipcRenderer.invoke("inventory:getInventory"),
  quickRefresh: () => ipcRenderer.invoke("inventory:quickRefresh"),
  runScan: (fetchRemotes: boolean) => ipcRenderer.invoke("inventory:runScan", fetchRemotes),
  onScanProgress: (callback: (progress: ScanProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => {
      callback(progress);
    };
    ipcRenderer.on("inventory:scanProgress", listener);
    return () => {
      ipcRenderer.removeListener("inventory:scanProgress", listener);
    };
  },
  saveAnnotation: (id: string, patch: AnnotationPatch) => ipcRenderer.invoke("inventory:saveAnnotation", id, patch),
  saveBatchAnnotations: (ids: string[], patch: AnnotationPatch) =>
    ipcRenderer.invoke("inventory:saveBatchAnnotations", ids, patch),
  generateScript: (action: string, ids: string[]) => ipcRenderer.invoke("inventory:generateScript", action, ids),
  getDocFiles: (id: string) => ipcRenderer.invoke("inventory:getDocFiles", id),
  getDocContent: (id: string, file: string) => ipcRenderer.invoke("inventory:getDocContent", id, file),
  openInIde: (id: string, ide: string) => ipcRenderer.invoke("inventory:openInIde", id, ide),
  fetchProject: (id: string) => ipcRenderer.invoke("inventory:fetchProject", id),
  scanProject: (id: string, fetchRemotes?: boolean) => ipcRenderer.invoke("inventory:scanProject", id, fetchRemotes),
  executeAction: (id: string, action: string) => ipcRenderer.invoke("inventory:executeAction", id, action),
  listGuidanceSessions: (projectId: string): Promise<GuidanceSessionList> => ipcRenderer.invoke("inventory:listGuidanceSessions", projectId),
  getGuidanceReviewInfo: (projectId: string): Promise<GuidanceReviewInfo> => ipcRenderer.invoke("inventory:getGuidanceReviewInfo", projectId),
  getGuidanceHistory: (projectId: string, sessionId: string, cursor?: string): Promise<GuidanceHistoryPage> =>
    ipcRenderer.invoke("inventory:getGuidanceHistory", projectId, sessionId, cursor),
  getGuidanceToolPayload: (projectId: string, callRef: string, section: "input" | "output" | "error", cursor?: string): Promise<GuidanceToolPayload> =>
    ipcRenderer.invoke("inventory:getGuidanceToolPayload", projectId, callRef, section, cursor),
  startGuidanceReview: (projectId: string, sessionIds: string[]): Promise<GuidanceReview> =>
    ipcRenderer.invoke("inventory:startGuidanceReview", projectId, sessionIds),
  getGuidanceReview: (reviewId: string): Promise<GuidanceReview> => ipcRenderer.invoke("inventory:getGuidanceReview", reviewId),
  cancelGuidanceReview: (reviewId: string): Promise<GuidanceReview> => ipcRenderer.invoke("inventory:cancelGuidanceReview", reviewId),
  applyGuidanceReview: (reviewId: string, editIds: string[]): Promise<GuidanceReview> =>
    ipcRenderer.invoke("inventory:applyGuidanceReview", reviewId, editIds),
  getCodingAgents: () => ipcRenderer.invoke("inventory:getCodingAgents"),
  startCodingRun: (projectId: string, agent: CodingAgent["id"], prompt: string) =>
    ipcRenderer.invoke("inventory:startCodingRun", projectId, agent, prompt),
  startBashRun: (projectId: string, command: string) =>
    ipcRenderer.invoke("inventory:startBashRun", projectId, command),
  stopCodingRun: (id: string) => ipcRenderer.invoke("inventory:stopCodingRun", id),

  onCodingRunEvent: (id: string, callback: (run: CodingRun) => void) => {
    const channelId = `coding-run-${id}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: Electron.IpcRendererEvent, run: CodingRun) => {
      callback(run);
    };
    ipcRenderer.on(channelId, listener);
    void ipcRenderer.invoke("inventory:subscribeCodingRun", { channelId, runId: id });

    return () => {
      ipcRenderer.removeListener(channelId, listener);
      void ipcRenderer.invoke("inventory:unsubscribeCodingRun", { channelId });
    };
  },

  streamChat: (
    request: { messages: Array<{ role: "user" | "assistant"; content: string }>; projectId?: string; preferredAgent?: string },
    onEvent: (event: ChatStreamEvent) => void,
    onDone: (error?: string) => void,
  ) => {
    const channelId = `chat-stream-${Math.random().toString(36).slice(2)}`;
    const listener = (_event: Electron.IpcRendererEvent, data: { event?: ChatStreamEvent; done?: boolean; error?: string }) => {
      if (data.event) {
        onEvent(data.event);
      }
      if (data.done) {
        ipcRenderer.removeListener(channelId, listener);
        onDone(data.error);
      }
    };
    ipcRenderer.on(channelId, listener);
    void ipcRenderer.invoke("inventory:streamChat", { channelId, request });

    return () => {
      ipcRenderer.removeListener(channelId, listener);
      void ipcRenderer.invoke("inventory:cancelStreamChat", { channelId });
    };
  },

  getConfig: () => ipcRenderer.invoke("inventory:getConfig"),
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
  }) => ipcRenderer.invoke("inventory:saveConfig", updates),
  selectDirectory: () => ipcRenderer.invoke("inventory:selectDirectory"),
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("app:open-settings", listener);
    return () => {
      ipcRenderer.removeListener("app:open-settings", listener);
    };
  },
  agentTools: {
    list: () => ipcRenderer.invoke("agentTools:list"),
    refresh: () => ipcRenderer.invoke("agentTools:refresh"),
    getDetails: (id: AgentToolId) => ipcRenderer.invoke("agentTools:getDetails", id),
    readResource: (ref: string) => ipcRenderer.invoke("agentTools:readResource", ref),
    openConfiguration: (req: OpenConfigurationRequest) => ipcRenderer.invoke("agentTools:openConfiguration", req),
    readSessionTranscript: (id: string, cursor?: string) => ipcRenderer.invoke("agentTools:readSessionTranscript", id, cursor),
  },
  readAgentSessionTranscript: (id: string, cursor?: string) => ipcRenderer.invoke("agentTools:readSessionTranscript", id, cursor),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
