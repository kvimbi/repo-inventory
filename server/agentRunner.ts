import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export const CODING_AGENT_IDS = ["codex", "opencode", "claude", "agy", "gemini"] as const;

export type CodingAgentId = typeof CODING_AGENT_IDS[number];
export type CodingRunStatus = "queued" | "running" | "succeeded" | "failed" | "stopped";

interface CodingAgentDefinition {
  id: CodingAgentId;
  label: string;
  command: string;
  buildArgs: (prompt: string) => string[];
}

export interface AvailableCodingAgent {
  id: CodingAgentId;
  label: string;
}

export interface BashExecutor {
  id: "bash";
  label: "Bash";
}

export interface CodingRunSnapshot {
  id: string;
  projectId: string;
  projectName: string;
  kind: "coding" | "bash";
  agent: AvailableCodingAgent | BashExecutor;
  prompt: string;
  status: CodingRunStatus;
  startedAt: string;
  finishedAt?: string;
  output: string;
}

const CODING_AGENTS: CodingAgentDefinition[] = [
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    buildArgs: (prompt) => ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", prompt],
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    buildArgs: (prompt) => ["run", prompt],
  },
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    buildArgs: (prompt) => ["--print", prompt],
  },
  {
    id: "agy",
    label: "Agy",
    command: "agy",
    buildArgs: (prompt) => ["--prompt", prompt],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    buildArgs: (prompt) => ["--prompt", prompt],
  },
];

const MAX_RUN_OUTPUT = 200_000;

function definitionFor(id: CodingAgentId) {
  return CODING_AGENTS.find((agent) => agent.id === id);
}

function isCommandAvailable(command: string) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    timeout: 2_000,
  });
  return result.error === undefined;
}

export function availableCodingAgents(): AvailableCodingAgent[] {
  return CODING_AGENTS
    .filter((agent) => isCommandAvailable(agent.command))
    .map(({ id, label }) => ({ id, label }));
}

export class CodingAgentRunner {
  private readonly runs = new Map<string, CodingRunSnapshot>();
  private readonly listeners = new Map<string, Set<(run: CodingRunSnapshot) => void>>();
  private readonly processes = new Map<string, ReturnType<typeof spawn>>();

  start(
    project: { id: string; name: string; path: string },
    agentId: CodingAgentId,
    prompt: string,
  ): CodingRunSnapshot {
    const definition = definitionFor(agentId);
    if (!definition || !isCommandAvailable(definition.command)) {
      throw new Error(`${agentId} is not available on PATH`);
    }

    return this.startProcess(
      project,
      { id: definition.id, label: definition.label },
      "coding",
      definition.command,
      definition.buildArgs(prompt),
      prompt,
    );
  }

  startBash(
    project: { id: string; name: string; path: string },
    command: string,
  ): CodingRunSnapshot {
    return this.startProcess(project, { id: "bash", label: "Bash" }, "bash", "bash", ["-lc", command], command);
  }

  private startProcess(
    project: { id: string; name: string; path: string },
    executor: AvailableCodingAgent | BashExecutor,
    kind: CodingRunSnapshot["kind"],
    command: string,
    args: string[],
    prompt: string,
  ): CodingRunSnapshot {
    const run: CodingRunSnapshot = {
      id: randomUUID(),
      projectId: project.id,
      projectName: project.name,
      kind,
      agent: executor,
      prompt,
      status: "queued",
      startedAt: new Date().toISOString(),
      output: "",
    };
    this.runs.set(run.id, run);

    const child = spawn(command, args, {
      cwd: project.path,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.processes.set(run.id, child);
    this.setStatus(run, "running");

    child.stdout.on("data", (chunk: Buffer) => this.appendOutput(run, chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => this.appendOutput(run, chunk.toString("utf8")));
    child.on("error", (error: Error) => {
      this.appendOutput(run, `\nCould not start ${executor.label}: ${error.message}\n`);
      this.finish(run, "failed");
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (run.status === "stopped") return;
      if (code === 0) {
        this.finish(run, "succeeded");
      } else {
        this.appendOutput(run, `\nProcess exited with ${signal ?? `code ${code ?? "unknown"}`}\n`);
        this.finish(run, "failed");
      }
    });

    return run;
  }

  get(id: string) {
    return this.runs.get(id);
  }

  stop(id: string) {
    const run = this.runs.get(id);
    const process = this.processes.get(id);
    if (!run || !process || run.status !== "running") return run;
    this.setStatus(run, "stopped");
    process.kill("SIGTERM");
    setTimeout(() => {
      if (!process.killed) process.kill("SIGKILL");
    }, 5_000).unref();
    return run;
  }

  subscribe(id: string, listener: (run: CodingRunSnapshot) => void) {
    const subscribers = this.listeners.get(id) ?? new Set<(run: CodingRunSnapshot) => void>();
    subscribers.add(listener);
    this.listeners.set(id, subscribers);
    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) this.listeners.delete(id);
    };
  }

  private appendOutput(run: CodingRunSnapshot, text: string) {
    run.output = (run.output + text).slice(-MAX_RUN_OUTPUT);
    this.emit(run);
  }

  private setStatus(run: CodingRunSnapshot, status: CodingRunStatus) {
    run.status = status;
    this.emit(run);
  }

  private finish(run: CodingRunSnapshot, status: Extract<CodingRunStatus, "succeeded" | "failed">) {
    this.processes.delete(run.id);
    run.status = status;
    run.finishedAt = new Date().toISOString();
    this.emit(run);
  }

  private emit(run: CodingRunSnapshot) {
    for (const listener of this.listeners.get(run.id) ?? []) {
      listener(run);
    }
  }
}
