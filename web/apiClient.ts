import type { Inventory, Annotation, Project, ProjectStatus, ScanProgress, GuidanceHistoryPage, GuidanceReview, GuidanceReviewInfo, GuidanceSessionList, GuidanceToolPayload, AgentToolId, AgentToolsListResult, AgentToolDetails, AgentResourcePreview, OpenConfigurationRequest, OpenConfigurationResult } from "../core/types.ts";
import { isElectron, type ChatStreamEvent, type AppConfig } from "./electronBridge.ts";

export type { ChatStreamEvent, AppConfig, ScanProgress };

export interface AnnotationPatch {
  status?: ProjectStatus;
  note?: string;
  snoozedUntil?: string | null;
  favourite?: boolean;
  todo?: boolean;
  alias?: string | null;
  suppressedFlags?: string[];
}

export interface ScriptResult {
  script: string;
  included: string[];
  skipped: string[];
}

export interface DocFile {
  file: string;
  bytes?: number;
}

export interface DocContent {
  file: string;
  content: string;
  truncated: boolean;
  isMarkdown: boolean;
}

export interface CodingAgent {
  id: "codex" | "opencode" | "claude" | "agy" | "gemini";
  label: string;
}

export interface CodingRun {
  id: string;
  projectId: string;
  projectName: string;
  kind: "coding" | "bash";
  agent: CodingAgent | { id: "bash"; label: "Bash" };
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed" | "stopped";
  startedAt: string;
  finishedAt?: string;
  output: string;
}

export interface ChatMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequestData {
  messages: ChatMessageInput[];
  projectId?: string;
  preferredAgent?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function fetchInventory(): Promise<Inventory> {
  if (isElectron()) {
    return window.electronAPI!.getInventory();
  }
  return request<Inventory>("/api/inventory");
}

export async function quickRefresh(): Promise<Inventory> {
  if (isElectron()) {
    return window.electronAPI!.quickRefresh();
  }
  return request<Inventory>("/api/refresh/quick", {
    method: "POST",
  });
}

export async function runScan(fetchRemotes: boolean): Promise<Inventory> {
  if (isElectron()) {
    return window.electronAPI!.runScan(fetchRemotes);
  }
  return request<Inventory>("/api/scan", {
    method: "POST",
    body: JSON.stringify({ fetch: fetchRemotes }),
  });
}

export async function saveAnnotation(
  id: string,
  patch: AnnotationPatch,
): Promise<{ annotation: Annotation; project: Project | null }> {
  if (isElectron()) {
    return window.electronAPI!.saveAnnotation(id, patch);
  }
  return request<{ annotation: Annotation; project: Project | null }>("/api/annotation", {
    method: "POST",
    body: JSON.stringify({ id, ...patch }),
  });
}

export async function saveBatchAnnotations(
  ids: string[],
  patch: AnnotationPatch,
): Promise<{ annotations: Record<string, Annotation>; inventory: Inventory | null; projects: Project[] }> {
  if (isElectron()) {
    return window.electronAPI!.saveBatchAnnotations(ids, patch);
  }
  return request<{ annotations: Record<string, Annotation>; inventory: Inventory | null; projects: Project[] }>("/api/annotations/batch", {
    method: "POST",
    body: JSON.stringify({ ids, ...patch }),
  });
}

export async function generateScript(action: string, ids: string[]): Promise<ScriptResult> {
  if (isElectron()) {
    return window.electronAPI!.generateScript(action, ids);
  }
  return request<ScriptResult>("/api/script", {
    method: "POST",
    body: JSON.stringify({ action, ids }),
  });
}

export async function fetchDocFiles(id: string): Promise<DocFile[]> {
  if (isElectron()) {
    return window.electronAPI!.getDocFiles(id);
  }
  return request<DocFile[]>(`/api/docs?id=${encodeURIComponent(id)}`);
}

export async function fetchDocContent(id: string, file: string): Promise<DocContent> {
  if (isElectron()) {
    return window.electronAPI!.getDocContent(id, file);
  }
  return request<DocContent>(`/api/doc?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`);
}

export async function openInIde(id: string, ide: string): Promise<void> {
  if (isElectron()) {
    return window.electronAPI!.openInIde(id, ide);
  }
  await request<{ ok: boolean }>("/api/open", {
    method: "POST",
    body: JSON.stringify({ id, ide }),
  });
}

export async function fetchProject(id: string): Promise<{ ok: boolean; inventory?: Inventory; project: Project | null }> {
  if (isElectron()) {
    return window.electronAPI!.fetchProject(id);
  }
  return request<{ ok: boolean; inventory?: Inventory; project: Project | null }>("/api/fetch", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export async function rescanSingleProject(
  id: string,
  fetchRemotes: boolean = true,
): Promise<{ ok: boolean; inventory: Inventory; project: Project }> {
  if (isElectron()) {
    return window.electronAPI!.scanProject(id, fetchRemotes);
  }
  return request<{ ok: boolean; inventory: Inventory; project: Project }>("/api/scan-project", {
    method: "POST",
    body: JSON.stringify({ id, fetch: fetchRemotes }),
  });
}

export async function executeAction(
  id: string,
  action: string,
): Promise<{ ok: boolean; inventory: Inventory; project: Project }> {
  if (isElectron()) {
    return window.electronAPI!.executeAction(id, action);
  }
  return request<{ ok: boolean; inventory: Inventory; project: Project }>("/api/execute-action", {
    method: "POST",
    body: JSON.stringify({ id, action }),
  });
}

export async function listGuidanceSessions(projectId: string): Promise<GuidanceSessionList> {
  if (isElectron()) return window.electronAPI!.listGuidanceSessions(projectId);
  return request<GuidanceSessionList>(`/api/guidance/sessions?projectId=${encodeURIComponent(projectId)}`);
}

export async function fetchGuidanceReviewInfo(projectId: string): Promise<GuidanceReviewInfo> {
  if (isElectron()) return window.electronAPI!.getGuidanceReviewInfo(projectId);
  return request<GuidanceReviewInfo>(`/api/guidance/info?projectId=${encodeURIComponent(projectId)}`);
}

export async function fetchGuidanceHistory(projectId: string, sessionId: string, cursor?: string): Promise<GuidanceHistoryPage> {
  if (isElectron()) return window.electronAPI!.getGuidanceHistory(projectId, sessionId, cursor);
  const query = new URLSearchParams({ projectId, sessionId });
  if (cursor) query.set("cursor", cursor);
  return request<GuidanceHistoryPage>(`/api/guidance/history?${query}`);
}

export async function fetchGuidanceToolPayload(
  projectId: string,
  callRef: string,
  section: "input" | "output" | "error",
  cursor?: string,
): Promise<GuidanceToolPayload> {
  if (isElectron()) return window.electronAPI!.getGuidanceToolPayload(projectId, callRef, section, cursor);
  const query = new URLSearchParams({ projectId, callRef, section });
  if (cursor) query.set("cursor", cursor);
  return request<GuidanceToolPayload>(`/api/guidance/tool?${query}`);
}

export async function startGuidanceReview(projectId: string, sessionIds: string[]): Promise<GuidanceReview> {
  if (isElectron()) return window.electronAPI!.startGuidanceReview(projectId, sessionIds);
  return (await request<{ review: GuidanceReview }>("/api/guidance/reviews", { method: "POST", body: JSON.stringify({ projectId, sessionIds }) })).review;
}

export async function fetchGuidanceReview(reviewId: string): Promise<GuidanceReview> {
  if (isElectron()) return window.electronAPI!.getGuidanceReview(reviewId);
  return (await request<{ review: GuidanceReview }>(`/api/guidance/reviews/${encodeURIComponent(reviewId)}`)).review;
}

export async function cancelGuidanceReview(reviewId: string): Promise<GuidanceReview> {
  if (isElectron()) return window.electronAPI!.cancelGuidanceReview(reviewId);
  return (await request<{ review: GuidanceReview }>(`/api/guidance/reviews/${encodeURIComponent(reviewId)}/cancel`, { method: "POST" })).review;
}

export async function applyGuidanceReview(reviewId: string, editIds: string[]): Promise<GuidanceReview> {
  if (isElectron()) return window.electronAPI!.applyGuidanceReview(reviewId, editIds);
  return (await request<{ review: GuidanceReview }>(`/api/guidance/reviews/${encodeURIComponent(reviewId)}/apply`, { method: "POST", body: JSON.stringify({ editIds }) })).review;
}

export async function fetchCodingAgents(): Promise<CodingAgent[]> {
  if (isElectron()) {
    return window.electronAPI!.getCodingAgents();
  }
  const result = await request<{ agents: CodingAgent[] }>("/api/chat/agents");
  return result.agents;
}

export async function startCodingRun(
  projectId: string,
  agent: CodingAgent["id"],
  prompt: string,
): Promise<CodingRun> {
  if (isElectron()) {
    return window.electronAPI!.startCodingRun(projectId, agent, prompt);
  }
  const result = await request<{ run: CodingRun }>("/api/chat/runs", {
    method: "POST",
    body: JSON.stringify({ projectId, agent, prompt }),
  });
  return result.run;
}

export async function stopCodingRun(id: string): Promise<CodingRun> {
  if (isElectron()) {
    return window.electronAPI!.stopCodingRun(id);
  }
  const result = await request<{ run: CodingRun }>(`/api/chat/runs/${encodeURIComponent(id)}/stop`, {
    method: "POST",
  });
  return result.run;
}

export async function startBashRun(projectId: string, command: string): Promise<CodingRun> {
  if (isElectron()) {
    return window.electronAPI!.startBashRun(projectId, command);
  }
  const result = await request<{ run: CodingRun }>("/api/chat/bash-runs", {
    method: "POST",
    body: JSON.stringify({ projectId, command }),
  });
  return result.run;
}

export function subscribeCodingRunEvents(id: string, onUpdate: (run: CodingRun) => void): () => void {
  if (isElectron()) {
    return window.electronAPI!.onCodingRunEvent(id, onUpdate);
  }

  const source = new EventSource(`/api/chat/runs/${encodeURIComponent(id)}/events`);
  source.addEventListener("run", (event) => {
    try {
      const next = JSON.parse((event as MessageEvent<string>).data) as CodingRun;
      onUpdate(next);
      if (next.status !== "queued" && next.status !== "running") {
        source.close();
      }
    } catch {
      source.close();
    }
  });
  source.onerror = () => source.close();
  return () => source.close();
}

export async function streamProjectChat(
  data: ChatRequestData,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (isElectron()) {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new Error("aborted"));
      }
      const cleanup = window.electronAPI!.streamChat(
        data,
        onEvent,
        (error) => {
          if (error) reject(new Error(error));
          else resolve();
        },
      );
      if (signal) {
        signal.addEventListener("abort", () => {
          cleanup();
          reject(new Error("aborted"));
        });
      }
    });
  }

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    signal,
  });

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not start the project chat");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const match = block.match(/^event:\s*([^\n]+)\ndata:\s*(.*)$/s);
      if (!match) continue;
      const [, eventType, rawData] = match;
      if (eventType === "done") return;
      try {
        const payload = JSON.parse(rawData);
        if (eventType === "error") {
          onEvent({ type: "error", text: payload.text ?? "Chat stream error" });
        } else {
          onEvent(payload as ChatStreamEvent);
        }
      } catch {
        // parse error ignored
      }
    }
  }
}

export async function fetchConfig(): Promise<AppConfig> {
  if (isElectron() && window.electronAPI) {
    return window.electronAPI.getConfig();
  }
  return request<AppConfig>("/api/config");
}

export async function updateConfig(updates: {
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
}): Promise<AppConfig> {
  if (isElectron() && window.electronAPI) {
    return window.electronAPI.saveConfig(updates);
  }
  return request<AppConfig>("/api/config", {
    method: "POST",
    body: JSON.stringify(updates),
  });
}

export async function chooseDirectory(): Promise<string | null> {
  if (isElectron() && window.electronAPI) {
    return window.electronAPI.selectDirectory();
  }
  throw new Error("Directory selection is only available in the Electron desktop application");
}

export function onOpenSettings(callback: () => void): () => void {
  if (isElectron() && window.electronAPI?.onOpenSettings) {
    return window.electronAPI.onOpenSettings(callback);
  }
  return () => {};
}

export function subscribeScanProgress(callback: (progress: ScanProgress) => void): () => void {
  if (isElectron() && window.electronAPI?.onScanProgress) {
    return window.electronAPI.onScanProgress(callback);
  }
  return () => {};
}

export async function listAgentTools(): Promise<AgentToolsListResult> {
  if (isElectron() && window.electronAPI?.agentTools) {
    const tools = await window.electronAPI.agentTools.list();
    return { tools };
  }
  return request<AgentToolsListResult>("/api/agent-tools");
}

export async function refreshAgentTools(): Promise<AgentToolsListResult> {
  if (isElectron() && window.electronAPI?.agentTools) {
    const tools = await window.electronAPI.agentTools.refresh();
    return { tools };
  }
  return request<AgentToolsListResult>("/api/agent-tools/refresh", {
    method: "POST",
  });
}

export async function getAgentToolDetails(id: AgentToolId): Promise<AgentToolDetails | null> {
  if (isElectron() && window.electronAPI?.agentTools) {
    return window.electronAPI.agentTools.getDetails(id);
  }
  const response = await fetch(`/api/agent-tools/${encodeURIComponent(id)}`, {
    headers: { "content-type": "application/json" },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as AgentToolDetails;
}

export async function readAgentResource(ref: string): Promise<AgentResourcePreview> {
  if (isElectron() && window.electronAPI?.agentTools?.readResource) {
    return window.electronAPI.agentTools.readResource(ref);
  }
  return request<AgentResourcePreview>(`/api/agent-tools/resources/preview?ref=${encodeURIComponent(ref)}`);
}

export async function openAgentConfiguration(req: OpenConfigurationRequest): Promise<OpenConfigurationResult> {
  if (isElectron() && window.electronAPI?.agentTools?.openConfiguration) {
    return window.electronAPI.agentTools.openConfiguration(req);
  }
  return request<OpenConfigurationResult>("/api/agent-tools/config/open", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function readAgentSessionTranscript(id: string, cursor?: string): Promise<GuidanceHistoryPage> {
  if (isElectron() && window.electronAPI?.agentTools?.readSessionTranscript) {
    return window.electronAPI.agentTools.readSessionTranscript(id, cursor);
  }
  if (isElectron() && window.electronAPI?.readAgentSessionTranscript) {
    return window.electronAPI.readAgentSessionTranscript(id, cursor);
  }
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request<GuidanceHistoryPage>(`/api/agent-tools/sessions/${encodeURIComponent(id)}/transcript${query}`);
}
