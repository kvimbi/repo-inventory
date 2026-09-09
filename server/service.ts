import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { stat, readFile } from "node:fs/promises";
import { scan, readInventory, quickRefresh, refresh, reprobeProject } from "../core/scan.ts";
import { AnnotationStore } from "../core/state.ts";
import {
  RENDERABLE_DOC_FILES,
  loadConfig,
  saveConfig,
  DEFAULT_ALLOWED_ROOT_BASH_PATTERNS,
  type Config,
} from "../core/config.ts";
import { IDE_LAUNCHERS } from "../core/ides.ts";
import { run } from "../core/exec.ts";
import type { Inventory, Project, Annotation, ProjectStatus, ScanProgress } from "../core/types.ts";
import { executeGitAction } from "./git.ts";
import { generateScript, type ScriptGenerationResult } from "./scripts.ts";
import {
  CodingAgentRunner,
  availableCodingAgents,
  type CodingAgentId,
  type AvailableCodingAgent,
  type CodingRunSnapshot,
} from "./agentRunner.ts";
import {
  OpenCodeRunner,
  type OpenCodeRunResult,
  type OpenCodeTaskSnapshot,
  type OpenCodeTaskStatus,
} from "./opencodeRunner.ts";
import { type ChatRequest, type ChatStreamEvent, streamProjectChat } from "./chat.ts";
import { GuidanceReviewService } from "./guidanceReview.ts";
import type { GuidanceHistoryPage, GuidanceReview, GuidanceReviewInfo, GuidanceSessionList, GuidanceToolPayload } from "../core/types.ts";

const MAX_DOC_BYTES = 1_000_000;

export interface AnnotationPatch {
  status?: ProjectStatus;
  note?: string;
  snoozedUntil?: string | null;
  favourite?: boolean;
  todo?: boolean;
  alias?: string | null;
  suppressedFlags?: string[];
}

export interface DocFileInfo {
  file: string;
  bytes: number;
}

export interface DocContentResult {
  file: string;
  content: string;
  truncated: boolean;
  isMarkdown: boolean;
}

export class InventoryService {
  private baseDir: string;
  private current: Inventory | null = null;
  private scanning: Promise<Inventory> | null = null;
  private scanProgressListeners = new Set<(progress: ScanProgress) => void>();
  private codingAgentRunner = new CodingAgentRunner();
  private opencodeRunner = new OpenCodeRunner();
  private guidanceReview: GuidanceReviewService;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.guidanceReview = new GuidanceReviewService(
      baseDir,
      async (id) => {
        if (!this.current) await this.getInventory();
        const project = this.current?.projects.find((candidate) => candidate.id === id);
        return project ? { id: project.id, path: project.path } : undefined;
      },
      async () => {
        const config = await loadConfig(this.baseDir);
        return {
          aiProvider: config.aiProvider,
          geminiApiKey: config.geminiApiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
          bedrockApiKey: config.bedrockApiKey ?? process.env.AWS_BEARER_TOKEN_BEDROCK,
          bedrockRegion: config.bedrockRegion ?? process.env.AWS_REGION,
          guidanceReviewProvider: config.guidanceReviewProvider,
          guidanceReviewModel: config.guidanceReviewModel,
          openCodeDatabasePath: config.openCodeDatabasePath,
          claudeConfigDir: config.claudeConfigDir,
          claudeDesktopSessionsPath: config.claudeDesktopSessionsPath,
          claudeCoworkSessionsPath: config.claudeCoworkSessionsPath,
          codexHome: config.codexHome,
          guidanceHistorySources: config.guidanceHistorySources,
        };
      },
    );
  }

  onScanProgress(listener: (progress: ScanProgress) => void): () => void {
    this.scanProgressListeners.add(listener);
    return () => {
      this.scanProgressListeners.delete(listener);
    };
  }

  private emitScanProgress(progress: ScanProgress): void {
    for (const listener of this.scanProgressListeners) {
      try {
        listener(progress);
      } catch {
        // Listener errors are ignored to safeguard service execution.
      }
    }
  }

  async getHealth(): Promise<{ ok: boolean; scannedAt: string | null; scanning: boolean }> {
    return {
      ok: true,
      scannedAt: this.current?.scannedAt ?? null,
      scanning: this.scanning !== null,
    };
  }

  async getInventory(onProgress?: (progress: ScanProgress) => void): Promise<Inventory> {
    const notify = (p: ScanProgress) => {
      this.emitScanProgress(p);
      onProgress?.(p);
    };

    if (this.scanning) {
      return await this.scanning;
    }

    if (!this.current || this.current.projects.length === 0) {
      notify({ phase: "refreshing", message: "Loading cached inventory…" });
      this.current = await readInventory(this.baseDir);
      if (!this.current || this.current.projects.length === 0) {
        notify({ phase: "discovering", message: "No cached inventory found. Scanning workspace…" });
        this.current = await this.runScan(false, onProgress);
      }
    } else {
      notify({ phase: "refreshing", message: "Updating project annotations…" });
      this.current = await refresh(this.baseDir, this.current);
    }
    notify({
      phase: "ready",
      message: "Inventory ready",
      done: this.current.projects.length,
      total: this.current.projects.length,
    });
    return this.current;
  }

  async quickRefresh(onProgress?: (progress: ScanProgress) => void): Promise<Inventory> {
    const notify = (p: ScanProgress) => {
      this.emitScanProgress(p);
      onProgress?.(p);
    };

    if (this.scanning) {
      return await this.scanning;
    }

    try {
      if (!this.current || this.current.projects.length === 0) {
        this.current = await readInventory(this.baseDir);
      }
      if (!this.current || this.current.projects.length === 0) {
        return await this.runScan(false, onProgress);
      }
      notify({ phase: "starting", message: "Starting quick refresh of active projects…" });
      const promise = quickRefresh({
        baseDir: this.baseDir,
        inventory: this.current,
        onProgress: notify,
      });
      this.scanning = promise;
      this.current = await promise;
      return this.current;
    } finally {
      this.scanning = null;
    }
  }

  async runScan(fetchRemotes: boolean = false, onProgress?: (progress: ScanProgress) => void): Promise<Inventory> {
    const notify = (p: ScanProgress) => {
      this.emitScanProgress(p);
      onProgress?.(p);
    };

    if (this.scanning) {
      return await this.scanning;
    }
    try {
      notify({
        phase: "starting",
        message: fetchRemotes ? "Starting scan with remote fetch…" : "Starting scan…",
      });
      this.scanning = scan({
        baseDir: this.baseDir,
        fetch: fetchRemotes,
        onProgress: notify,
      });
      this.current = await this.scanning;
      notify({
        phase: "ready",
        message: "Scan completed",
        done: this.current.projects.length,
        total: this.current.projects.length,
      });
      return this.current;
    } finally {
      this.scanning = null;
    }
  }

  async saveAnnotation(
    id: string,
    patch: AnnotationPatch,
  ): Promise<{ annotation: Annotation; project: Project | null }> {
    const store = await AnnotationStore.open(this.baseDir);
    const annotation = await store.update(id, patch);

    let project = null;
    if (this.current) {
      const refreshed = await refresh(this.baseDir, this.current);
      this.current = refreshed;
      project = refreshed.projects.find((p) => p.id === id) ?? null;
    }

    return { annotation, project };
  }

  async saveBatchAnnotations(
    ids: string[],
    patch: AnnotationPatch,
  ): Promise<{ annotations: Record<string, Annotation>; inventory: Inventory | null; projects: Project[] }> {
    const store = await AnnotationStore.open(this.baseDir);
    const annotations = await store.updateBatch(ids, patch);

    let inventory = this.current;
    let projects: Project[] = [];
    if (this.current) {
      const refreshed = await refresh(this.baseDir, this.current);
      this.current = refreshed;
      inventory = refreshed;
      const idSet = new Set(ids);
      projects = refreshed.projects.filter((p) => idSet.has(p.id));
    }

    return { annotations, inventory, projects };
  }

  async generateScript(action: string, ids: string[]): Promise<ScriptGenerationResult> {
    if (!this.current) {
      await this.getInventory();
    }
    if (!this.current) {
      throw new Error("no inventory available");
    }
    const { error, result } = await generateScript(this.baseDir, action, ids, this.current);
    if (error || !result) {
      throw new Error(error ?? "could not generate script");
    }
    return result;
  }

  async getDocFiles(id: string): Promise<DocFileInfo[]> {
    if (!this.current) {
      await this.getInventory();
    }
    const project = this.current?.projects.find((p) => p.id === id);
    if (!project) {
      throw new Error("unknown project id");
    }

    const candidateFiles = [...RENDERABLE_DOC_FILES];
    if (project.skills) {
      for (const skill of project.skills) {
        if (skill.docFile && !candidateFiles.includes(skill.docFile)) {
          candidateFiles.push(skill.docFile);
        }
      }
    }

    const found: DocFileInfo[] = [];
    const seenInodes = new Set<string>();
    for (const file of candidateFiles) {
      try {
        const s = await stat(resolve(project.path, file));
        if (!s.isFile()) continue;
        const inodeKey = `${s.dev}:${s.ino}`;
        if (seenInodes.has(inodeKey)) continue;
        seenInodes.add(inodeKey);
        found.push({ file, bytes: s.size });
      } catch {
        // file does not exist in target repo
      }
    }
    return found;
  }

  async getDocContent(id: string, file: string): Promise<DocContentResult> {
    const isAllowed =
      RENDERABLE_DOC_FILES.includes(file) ||
      /^(\.agents|\.claude)\/skills\/[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+\.md|\.md)?$/i.test(file);
    if (!isAllowed) {
      throw new Error("file is not on the renderable allowlist");
    }
    if (!this.current) {
      await this.getInventory();
    }
    const project = this.current?.projects.find((p) => p.id === id);
    if (!project) {
      throw new Error("unknown project id");
    }

    const projectRoot = resolve(project.path);
    const target = resolve(projectRoot, file);
    if (target !== projectRoot && !target.startsWith(projectRoot + sep)) {
      throw new Error("file escapes project directory");
    }

    const s = await stat(target);
    if (!s.isFile()) {
      throw new Error("not a file");
    }
    const buffer = await readFile(target);
    const truncated = buffer.byteLength > MAX_DOC_BYTES;
    const content = buffer.subarray(0, MAX_DOC_BYTES).toString("utf8");
    return {
      file,
      content,
      truncated,
      isMarkdown: /\.md$/i.test(file),
    };
  }

  async openInIde(id: string, ide: string): Promise<{ ok: boolean }> {
    const launcher = IDE_LAUNCHERS.find((l) => l.id === ide);
    if (!launcher) {
      throw new Error(`unknown ide: ${ide}`);
    }
    if (!this.current) {
      await this.getInventory();
    }
    const project = this.current?.projects.find((p) => p.id === id);
    if (!project) {
      throw new Error("unknown project id");
    }

    const home = homedir();
    const resolveCmd = (cmd: string) => (cmd.startsWith("~/") ? resolve(home, cmd.slice(2)) : cmd);
    const candidates = [
      launcher.command,
      ...(launcher.fallbackCommands?.map(resolveCmd) ?? []),
    ];

    const args = launcher.args ? [...launcher.args, project.path] : [project.path];
    let lastError = "";

    for (const cmd of candidates) {
      const result = await run(project.path, cmd, args);
      if (result.ok) {
        return { ok: true };
      }
      lastError = result.stderr.trim() || lastError;
    }

    const cmdStr = launcher.args ? `${launcher.command} ${launcher.args.join(" ")}` : launcher.command;
    throw new Error(`could not launch ${launcher.label} (\`${cmdStr}\` on PATH?): ${lastError || "command failed"}`);
  }

  async fetchProject(id: string): Promise<{ ok: boolean; inventory?: Inventory; project: Project | null }> {
    if (!this.current) {
      await this.getInventory();
    }
    const project = this.current?.projects.find((p) => p.id === id);
    if (!project) {
      throw new Error("unknown project id");
    }
    if (project.isGit !== true || project.hasRemote !== true) {
      throw new Error("project does not have a git remote");
    }

    const remoteName = project.remoteName ?? "origin";
    const result = await run(project.path, "git", ["fetch", "--prune", "--quiet", remoteName]);
    if (!result.ok) {
      throw new Error(`git fetch failed: ${result.stderr.trim() || "command failed"}`);
    }

    const { inventory: updatedInventory, project: updatedProject } = await reprobeProject(
      this.baseDir,
      project.id,
      this.current!,
    );
    this.current = updatedInventory;
    return { ok: true, inventory: this.current, project: updatedProject };
  }

  async scanProject(id: string, fetchRemotes: boolean = true): Promise<{ ok: boolean; inventory: Inventory; project: Project }> {
    if (!this.current) {
      await this.getInventory();
    }
    const project = this.current?.projects.find((p) => p.id === id);
    if (!project) {
      throw new Error("unknown project id");
    }

    const { inventory: updatedInventory, project: updatedProject } = await reprobeProject(
      this.baseDir,
      project.id,
      this.current!,
      fetchRemotes,
    );
    if (!updatedProject) {
      throw new Error("project not found during re-scan");
    }

    this.current = updatedInventory;
    return { ok: true, inventory: this.current, project: updatedProject };
  }

  async executeAction(id: string, action: string): Promise<{ ok: boolean; inventory: Inventory; project: Project }> {
    if (!this.current) {
      await this.getInventory();
    }
    const project = this.current?.projects.find((p) => p.id === id);
    if (!project) {
      throw new Error("unknown project id");
    }

    const res = await executeGitAction(action, project, this.baseDir, this.current!);
    if (!res.ok || !res.inventory || !res.project) {
      throw new Error(res.error ?? "git action failed");
    }

    this.current = res.inventory;
    const finalProject = this.current.projects.find((p) => p.id === id) ?? (res.project as Project);
    return { ok: true, inventory: this.current, project: finalProject };
  }

  getCodingAgents(): AvailableCodingAgent[] {
    return availableCodingAgents();
  }

  startCodingRun(projectId: string, agent: string, prompt: string): CodingRunSnapshot {
    if (typeof prompt !== "string" || prompt.trim() === "") {
      throw new Error("prompt is required");
    }
    if (prompt.length > 12_000) {
      throw new Error("prompt is too long");
    }
    if (!this.current) {
      throw new Error("no inventory available");
    }
    const project = this.current.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new Error("unknown project id");
    }
    if (!availableCodingAgents().some((candidate) => candidate.id === agent)) {
      throw new Error("coding agent is not available");
    }

    return this.codingAgentRunner.start(project, agent as CodingAgentId, prompt.trim());
  }

  startBashRun(projectId: string, command: string): CodingRunSnapshot {
    if (typeof command !== "string" || command.trim() === "") {
      throw new Error("command is required");
    }
    if (command.length > 12_000) {
      throw new Error("command is too long");
    }
    if (!this.current) {
      throw new Error("no inventory available");
    }
    const project = this.current.projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new Error("unknown project id");
    }

    return this.codingAgentRunner.startBash(project, command.trim());
  }

  getCodingRun(id: string): CodingRunSnapshot | undefined {
    return this.codingAgentRunner.get(id);
  }

  stopCodingRun(id: string): CodingRunSnapshot {
    const run = this.codingAgentRunner.stop(id);
    if (!run) {
      throw new Error("unknown coding run");
    }
    return run;
  }

  subscribeCodingRun(id: string, listener: (run: CodingRunSnapshot) => void): () => void {
    return this.codingAgentRunner.subscribe(id, listener);
  }

  async streamChat(
    request: ChatRequest,
    emit: (event: ChatStreamEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (request.projectId && !this.current?.projects.some((p) => p.id === request.projectId)) {
      throw new Error("unknown project id");
    }
    await streamProjectChat(this.baseDir, request, emit, signal);
  }

  async getConfig(): Promise<AppConfig> {
    const config = await loadConfig(this.baseDir);
    const geminiApiKey = config.geminiApiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
    const bedrockApiKey = config.bedrockApiKey ?? process.env.AWS_BEARER_TOKEN_BEDROCK ?? "";
    return {
      root: config.root,
      roots: config.roots ?? [config.root],
      aiProvider: config.aiProvider,
      geminiApiKey,
      hasGeminiApiKey: Boolean(geminiApiKey && geminiApiKey.trim().length > 0),
      bedrockApiKey,
      hasBedrockApiKey: Boolean(bedrockApiKey && bedrockApiKey.trim().length > 0),
      bedrockRegion: config.bedrockRegion,
      chatProvider: config.chatProvider,
      chatModel: config.chatModel,
      guidanceReviewProvider: config.guidanceReviewProvider,
      guidanceReviewModel: config.guidanceReviewModel,
      allowedRootBashPatterns:
        config.allowedRootBashPatterns ?? DEFAULT_ALLOWED_ROOT_BASH_PATTERNS,
      openCodeDatabasePath: config.openCodeDatabasePath,
      claudeConfigDir: config.claudeConfigDir,
      claudeDesktopSessionsPath: config.claudeDesktopSessionsPath,
      claudeCoworkSessionsPath: config.claudeCoworkSessionsPath,
      codexHome: config.codexHome,
      guidanceHistorySources: config.guidanceHistorySources,
    };
  }

  async saveConfig(updates: {
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
    const patch: Partial<Config> = {};
    if (updates.roots !== undefined) {
      patch.roots = updates.roots;
      if (updates.roots.length > 0) {
        patch.root = updates.roots[0];
      }
    }
    if (updates.aiProvider !== undefined) {
      patch.aiProvider = updates.aiProvider;
    }
    if (updates.geminiApiKey !== undefined) {
      patch.geminiApiKey = updates.geminiApiKey.trim();
    }
    if (updates.bedrockApiKey !== undefined) {
      patch.bedrockApiKey = updates.bedrockApiKey.trim();
    }
    if (updates.bedrockRegion !== undefined) {
      patch.bedrockRegion = updates.bedrockRegion.trim() || undefined;
    }
    if (updates.chatProvider !== undefined) {
      patch.chatProvider = updates.chatProvider;
    }
    if (updates.chatModel !== undefined) {
      patch.chatModel = updates.chatModel.trim() || undefined;
    }
    if (updates.guidanceReviewProvider !== undefined) {
      patch.guidanceReviewProvider = updates.guidanceReviewProvider;
    }
    if (updates.allowedRootBashPatterns !== undefined) {
      patch.allowedRootBashPatterns = updates.allowedRootBashPatterns;
    }
    if (updates.guidanceReviewModel !== undefined) {
      patch.guidanceReviewModel = updates.guidanceReviewModel.trim() || undefined;
    }
    if (updates.openCodeDatabasePath !== undefined) {
      patch.openCodeDatabasePath = updates.openCodeDatabasePath.trim() || undefined;
    }
    if (updates.claudeConfigDir !== undefined) {
      patch.claudeConfigDir = updates.claudeConfigDir.trim() || undefined;
    }
    if (updates.claudeDesktopSessionsPath !== undefined) {
      patch.claudeDesktopSessionsPath = updates.claudeDesktopSessionsPath.trim() || undefined;
    }
    if (updates.claudeCoworkSessionsPath !== undefined) {
      patch.claudeCoworkSessionsPath = updates.claudeCoworkSessionsPath.trim() || undefined;
    }
    if (updates.codexHome !== undefined) {
      patch.codexHome = updates.codexHome.trim() || undefined;
    }
    if (updates.guidanceHistorySources !== undefined) {
      patch.guidanceHistorySources = updates.guidanceHistorySources;
    }
    await saveConfig(this.baseDir, patch);
    return this.getConfig();
  }

  isOpenCodeAvailable(): boolean {
    return this.opencodeRunner.isOpenCodeInstalled();
  }

  async runOpenCodeAgent(
    projectId: string,
    instruction: string,
    model?: string,
    timeoutSeconds?: number,
  ): Promise<OpenCodeRunResult> {
    if (!this.current) {
      await this.getInventory();
    }
    const project = this.current?.projects.find(
      (candidate) =>
        candidate.id === projectId ||
        candidate.relPath === projectId ||
        candidate.path === projectId ||
        candidate.name === projectId,
    );
    if (!project) {
      throw new Error(`unknown project id: ${projectId}`);
    }

    return this.opencodeRunner.runAgent({
      project: { id: project.id, name: project.name, path: project.path },
      instruction,
      model,
      timeoutSeconds,
    });
  }

  async startOpenCodeTask(
    projectId: string,
    instruction: string,
    model?: string,
    timeoutSeconds?: number,
  ): Promise<string> {
    if (!this.current) {
      await this.getInventory();
    }
    const project = this.current?.projects.find(
      (candidate) =>
        candidate.id === projectId ||
        candidate.relPath === projectId ||
        candidate.path === projectId ||
        candidate.name === projectId,
    );
    if (!project) {
      throw new Error(`unknown project id: ${projectId}`);
    }

    return this.opencodeRunner.startTask({
      project: { id: project.id, name: project.name, path: project.path },
      instruction,
      model,
      timeoutSeconds,
    });
  }

  getOpenCodeTask(taskId: string): OpenCodeTaskSnapshot | undefined {
    return this.opencodeRunner.getTask(taskId);
  }

  cancelOpenCodeTask(taskId: string): OpenCodeTaskSnapshot | undefined {
    return this.opencodeRunner.cancelTask(taskId);
  }

  listOpenCodeTasks(): OpenCodeTaskSnapshot[] {
    return this.opencodeRunner.listTasks();
  }

  async listGuidanceSessions(projectId: string): Promise<GuidanceSessionList> {
    return this.guidanceReview.listSessions(projectId);
  }

  async getGuidanceReviewInfo(projectId: string): Promise<GuidanceReviewInfo> {
    return this.guidanceReview.getReviewInfo(projectId);
  }

  async getGuidanceHistory(projectId: string, sessionId: string, cursor?: string): Promise<GuidanceHistoryPage> {
    return this.guidanceReview.getHistory(projectId, sessionId, cursor);
  }

  async getGuidanceToolPayload(
    projectId: string,
    callRef: string,
    section: "input" | "output" | "error",
    cursor?: string,
  ): Promise<GuidanceToolPayload> {
    return this.guidanceReview.getToolPayload(projectId, callRef, section, cursor);
  }

  async startGuidanceReview(projectId: string, sessionIds: string[]): Promise<GuidanceReview> {
    return this.guidanceReview.startReview(projectId, sessionIds);
  }

  async getGuidanceReview(reviewId: string): Promise<GuidanceReview> {
    return this.guidanceReview.getReview(reviewId);
  }

  async cancelGuidanceReview(reviewId: string): Promise<GuidanceReview> {
    return this.guidanceReview.cancelReview(reviewId);
  }

  async applyGuidanceReview(reviewId: string, editIds: string[]): Promise<GuidanceReview> {
    return this.guidanceReview.applyEdits(reviewId, editIds);
  }

  async deleteGuidanceReview(reviewId: string): Promise<void> {
    return this.guidanceReview.deleteReview(reviewId);
  }
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
