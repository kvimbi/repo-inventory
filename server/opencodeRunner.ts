import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

export type OpenCodeTaskStatus = "working" | "completed" | "failed" | "cancelled" | "timed_out";

export interface OpenCodeToolCall {
  tool: string;
  status: string;
  title?: string;
}

export interface OpenCodeRunResult {
  taskId: string;
  projectId: string;
  projectName: string;
  status: OpenCodeTaskStatus;
  durationMs: number;
  finalResponse: string;
  toolCalls: OpenCodeToolCall[];
  sessionId?: string;
  tokens?: {
    input?: number;
    output?: number;
  };
  cost?: number;
  error?: string;
  sandboxed: true;
}

export interface OpenCodeTaskSnapshot {
  taskId: string;
  projectId: string;
  projectName: string;
  instruction: string;
  model?: string;
  status: OpenCodeTaskStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  finalResponse?: string;
  toolCalls: OpenCodeToolCall[];
  sessionId?: string;
  tokens?: {
    input?: number;
    output?: number;
  };
  cost?: number;
  error?: string;
  outputTail: string;
  sandboxed: true;
}

export const OPENCODE_AVAILABLE_MODELS = [
  "azure/gpt-5.6-luna",
  "azure/gpt-5.6-sol",
  "azure/gpt-5.6-terra",
  "azure/deepseek-v4-pro",
  "llm-proxy/claude-sonnet-4-6-aws",
  "llm-proxy/claude-opus-4-7-aws",
  "llm-proxy/claude-haiku-4-5-aws",
  "google/gemini-3.7-flash",
] as const;

export type OpenCodeModel = typeof OPENCODE_AVAILABLE_MODELS[number];

export const DEFAULT_OPENCODE_MODEL: OpenCodeModel = "azure/gpt-5.6-luna";

export interface SpawnOpenCodeOptions {
  project: { id: string; name: string; path: string };
  instruction: string;
  model?: OpenCodeModel | string;
  timeoutSeconds?: number;
}

const MAX_TAIL_CHARS = 50_000;
const DEFAULT_TIMEOUT_SECONDS = 300;

function isOpenCodeAvailable(): boolean {
  try {
    const result = spawnSync("opencode", ["--version"], {
      stdio: "ignore",
      timeout: 3_000,
    });
    return result.error === undefined && result.status === 0;
  } catch {
    return false;
  }
}

interface TaskRecord {
  snapshot: OpenCodeTaskSnapshot;
  child?: ChildProcess;
  timeoutTimer?: NodeJS.Timeout;
  textChunks: string[];
  fallbackText: string[];
  resolvePromise?: (result: OpenCodeRunResult) => void;
  rejectPromise?: (error: Error) => void;
}

export class OpenCodeRunner {
  private readonly tasks = new Map<string, TaskRecord>();

  isOpenCodeInstalled(): boolean {
    return isOpenCodeAvailable();
  }

  /**
   * Spawns a sandboxed OpenCode run and returns a promise resolving to the final result.
   */
  async runAgent(options: SpawnOpenCodeOptions): Promise<OpenCodeRunResult> {
    const taskId = this.startTask(options);
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Failed to initialize OpenCode task ${taskId}`);
    }

    return new Promise<OpenCodeRunResult>((resolve, reject) => {
      task.resolvePromise = resolve;
      task.rejectPromise = reject;

      // If the task ended synchronously before listeners attached
      if (task.snapshot.status !== "working") {
        resolve(this.toRunResult(task.snapshot));
      }
    });
  }

  /**
   * Starts an asynchronous background OpenCode task (call-now, fetch-later pattern).
   */
  startTask(options: SpawnOpenCodeOptions): string {
    if (!options.instruction || options.instruction.trim() === "") {
      throw new Error("instruction is required");
    }

    const taskId = randomUUID();
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const effectiveModel = options.model?.trim() || DEFAULT_OPENCODE_MODEL;

    const snapshot: OpenCodeTaskSnapshot = {
      taskId,
      projectId: options.project.id,
      projectName: options.project.name,
      instruction: options.instruction.trim(),
      model: effectiveModel,
      status: "working",
      startedAt,
      toolCalls: [],
      outputTail: "",
      sandboxed: true,
    };

    const task: TaskRecord = {
      snapshot,
      textChunks: [],
      fallbackText: [],
    };
    this.tasks.set(taskId, task);

    if (!this.isOpenCodeInstalled()) {
      snapshot.status = "failed";
      snapshot.finishedAt = new Date().toISOString();
      snapshot.durationMs = 0;
      snapshot.error = "OpenCode CLI ('opencode') is not available on PATH";
      return taskId;
    }

    // Build arguments enforcing read-only plan mode and headless JSON streaming
    const args: string[] = [
      "run",
      "--format",
      "json",
      "--agent",
      "plan",
      "--model",
      effectiveModel,
      options.instruction.trim(),
    ];

    try {
      const child = spawn("opencode", args, {
        cwd: options.project.path,
        env: {
          ...process.env,
          // CI=1 enforces non-interactive behavior so OpenCode never waits on stdin
          CI: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      task.child = child;

      const timeoutSec = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
      task.timeoutTimer = setTimeout(() => {
        this.handleTimeout(taskId);
      }, timeoutSec * 1000);

      let stdoutRemainder = "";
      child.stdout.on("data", (chunk: Buffer) => {
        const str = stdoutRemainder + chunk.toString("utf8");
        const lines = str.split("\n");
        stdoutRemainder = lines.pop() ?? "";
        for (const line of lines) {
          this.processOutputLine(task, line);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        this.appendOutputTail(task, text);
      });

      child.on("error", (err: Error) => {
        this.finishTask(taskId, "failed", `Process spawn error: ${err.message}`);
      });

      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        if (stdoutRemainder.trim()) {
          this.processOutputLine(task, stdoutRemainder);
          stdoutRemainder = "";
        }

        if (task.snapshot.status === "working") {
          if (code === 0) {
            this.finishTask(taskId, "completed");
          } else {
            const reason = signal ? `killed by ${signal}` : `exited with code ${code ?? "unknown"}`;
            this.finishTask(taskId, "failed", `OpenCode ${reason}`);
          }
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.finishTask(taskId, "failed", `Failed to spawn opencode process: ${msg}`);
    }

    return taskId;
  }

  getTask(taskId: string): OpenCodeTaskSnapshot | undefined {
    return this.tasks.get(taskId)?.snapshot;
  }

  listTasks(): OpenCodeTaskSnapshot[] {
    return Array.from(this.tasks.values()).map((t) => t.snapshot);
  }

  cancelTask(taskId: string): OpenCodeTaskSnapshot | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    if (task.snapshot.status === "working") {
      if (task.timeoutTimer) {
        clearTimeout(task.timeoutTimer);
        task.timeoutTimer = undefined;
      }

      if (task.child && !task.child.killed) {
        task.child.kill("SIGTERM");
        setTimeout(() => {
          if (task.child && !task.child.killed) {
            task.child.kill("SIGKILL");
          }
        }, 3_000).unref();
      }

      this.finishTask(taskId, "cancelled");
    }

    return task.snapshot;
  }

  private handleTimeout(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.snapshot.status !== "working") return;

    if (task.child && !task.child.killed) {
      task.child.kill("SIGTERM");
      setTimeout(() => {
        if (task.child && !task.child.killed) {
          task.child.kill("SIGKILL");
        }
      }, 2_000).unref();
    }

    this.finishTask(taskId, "timed_out", "Execution timed out");
  }

  private processOutputLine(task: TaskRecord, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    this.appendOutputTail(task, `${line}\n`);

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        this.handleJsonEvent(task, parsed);
        return;
      } catch {
        // Fall back to plain text handling if line is not valid JSON
      }
    }

    task.fallbackText.push(line);
  }

  private handleJsonEvent(task: TaskRecord, event: Record<string, unknown>): void {
    const eventType = typeof event.type === "string" ? event.type : "";

    if (typeof event.sessionID === "string" && !task.snapshot.sessionId) {
      task.snapshot.sessionId = event.sessionID;
    }

    if (eventType === "tool_use" && typeof event.part === "object" && event.part !== null) {
      const part = event.part as Record<string, unknown>;
      const toolName = typeof part.tool === "string" ? part.tool : "unknown";
      const state = typeof part.state === "object" && part.state !== null ? (part.state as Record<string, unknown>) : {};
      const status = typeof state.status === "string" ? state.status : "completed";
      const title = typeof state.title === "string" ? state.title : undefined;

      task.snapshot.toolCalls.push({
        tool: toolName,
        status,
        title,
      });
    } else if (eventType === "step_finish" && typeof event.part === "object" && event.part !== null) {
      const part = event.part as Record<string, unknown>;
      if (typeof part.tokens === "object" && part.tokens !== null) {
        const tokensObj = part.tokens as Record<string, unknown>;
        task.snapshot.tokens = {
          input: typeof tokensObj.input === "number" ? tokensObj.input : undefined,
          output: typeof tokensObj.output === "number" ? tokensObj.output : undefined,
        };
      }
      if (typeof part.cost === "number") {
        task.snapshot.cost = part.cost;
      }
    } else if (eventType === "error" && typeof event.error === "object" && event.error !== null) {
      const errObj = event.error as Record<string, unknown>;
      task.snapshot.error = typeof errObj.data === "string" ? errObj.data : typeof errObj.name === "string" ? errObj.name : "Unknown error";
    }

    // Extract any message/text content emitted in the event
    if (typeof event.content === "string") {
      task.textChunks.push(event.content);
    } else if (typeof event.text === "string") {
      task.textChunks.push(event.text);
    } else if (typeof event.part === "object" && event.part !== null) {
      const part = event.part as Record<string, unknown>;
      if (typeof part.text === "string") {
        task.textChunks.push(part.text);
      } else if (typeof part.content === "string") {
        task.textChunks.push(part.content);
      }
    }
  }

  private appendOutputTail(task: TaskRecord, text: string): void {
    task.snapshot.outputTail = (task.snapshot.outputTail + text).slice(-MAX_TAIL_CHARS);
  }

  private finishTask(
    taskId: string,
    status: OpenCodeTaskStatus,
    error?: string,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    if (task.timeoutTimer) {
      clearTimeout(task.timeoutTimer);
      task.timeoutTimer = undefined;
    }

    const startMs = new Date(task.snapshot.startedAt).getTime();
    const endMs = Date.now();
    task.snapshot.finishedAt = new Date(endMs).toISOString();
    task.snapshot.durationMs = endMs - startMs;
    task.snapshot.status = status;

    if (error && !task.snapshot.error) {
      task.snapshot.error = error;
    }

    // Assemble the final response text
    if (task.textChunks.length > 0) {
      task.snapshot.finalResponse = task.textChunks.join("\n").trim();
    } else if (task.fallbackText.length > 0) {
      task.snapshot.finalResponse = task.fallbackText.join("\n").trim();
    } else {
      task.snapshot.finalResponse = task.snapshot.error ?? "No response generated";
    }

    const result = this.toRunResult(task.snapshot);

    if (task.resolvePromise) {
      task.resolvePromise(result);
    }
  }

  private toRunResult(snapshot: OpenCodeTaskSnapshot): OpenCodeRunResult {
    return {
      taskId: snapshot.taskId,
      projectId: snapshot.projectId,
      projectName: snapshot.projectName,
      status: snapshot.status,
      durationMs: snapshot.durationMs ?? 0,
      finalResponse: snapshot.finalResponse ?? snapshot.error ?? "",
      toolCalls: snapshot.toolCalls,
      sessionId: snapshot.sessionId,
      tokens: snapshot.tokens,
      cost: snapshot.cost,
      error: snapshot.error,
      sandboxed: true,
    };
  }
}
