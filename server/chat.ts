import { createMCPClient } from "@ai-sdk/mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolveLanguageModel } from "./aiProvider.ts";
import { stepCountIs, streamText, tool, type ToolSet } from "ai";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { ensureAugmentedEnv } from "../core/env.ts";
import { loadConfig, DEFAULT_ALLOWED_ROOT_BASH_PATTERNS } from "../core/config.ts";
import { availableCodingAgents, type CodingAgentId } from "./agentRunner.ts";
import { createMcpServer } from "./mcp.ts";
import { validateSearchCommand } from "./commandValidator.ts";

const execAsync = promisify(exec);

function getExecutionEnv(): NodeJS.ProcessEnv {
  return ensureAugmentedEnv();
}

const READ_ONLY_MCP_TOOLS = new Set([
  "list_projects",
  "get_project",
  "search_projects",
  "get_project_doc",
]);

export interface ChatMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessageInput[];
  projectId?: string;
  preferredAgent?: CodingAgentId;
}

export interface ChatStreamEvent {
  type: "text" | "reasoning" | "tool-call" | "tool-result" | "error";
  text?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
}

function isChatMessage(value: unknown): value is ChatMessageInput {
  if (!value || typeof value !== "object") return false;
  const message = value as { role?: unknown; content?: unknown };
  return (message.role === "user" || message.role === "assistant") && typeof message.content === "string";
}

export function parseChatRequest(value: unknown): { data?: ChatRequest; error?: string } {
  if (!value || typeof value !== "object") return { error: "request body is required" };
  const body = value as { messages?: unknown; projectId?: unknown; preferredAgent?: unknown };
  if (!Array.isArray(body.messages) || body.messages.length === 0 || !body.messages.every(isChatMessage)) {
    return { error: "messages must be a non-empty list of user or assistant messages" };
  }
  if (body.messages.length > 30 || body.messages.some((message) => message.content.length > 16_000)) {
    return { error: "chat history is too large" };
  }
  if (body.projectId !== undefined && typeof body.projectId !== "string") {
    return { error: "projectId must be a string" };
  }
  if (body.preferredAgent !== undefined && !availableCodingAgents().some((agent) => agent.id === body.preferredAgent)) {
    return { error: "preferredAgent is not available" };
  }
  return {
    data: {
      messages: body.messages,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      preferredAgent: body.preferredAgent as CodingAgentId | undefined,
    },
  };
}

function instructions(
  projectId: string | undefined,
  preferredAgent: CodingAgentId | undefined,
  roots: string[],
) {
  const available = availableCodingAgents();
  const agentNames = available.map((agent) => `${agent.label} (${agent.id})`).join(", ");
  const rootsList = roots.join(", ");
  return `You are the repo-inventory assistant. Help the user understand and manage projects from the inventory.

Use the inventory MCP tools for factual claims. These tools are read-only in this chat: never promise to edit files, annotations, git history, remotes, or project state. The selected project scope is ${projectId ? `project id ${projectId}` : "all projects"}; prefer it unless the user clearly asks to compare projects. Configured workspace roots: ${rootsList}.

When looking for missing projects, unmanifested repositories, untracked folders, or exploring directory hierarchies, use the search_root_terminal tool to run read-only terminal search commands (like find, grep, rg, ls, tree, file, stat, git status). Inspect matching directories, determine why discovery skipped them (e.g. missing package.json/Cargo.toml or uninitialized git), and explain your findings to the user.

When a project is selected and the user explicitly asks to run a command, use run_bash_command. When they explicitly ask a coding CLI to investigate or change that selected project, use run_coding_agent. The user requested the action, so each tool starts its process immediately. They always run in the selected project; do not ask for or choose another project. Available agents: ${agentNames || "none"}. Preferred agent: ${preferredAgent ?? "none"}.`;
}

export async function streamProjectChat(
  baseDir: string,
  request: ChatRequest,
  emit: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
) {
  const config = await loadConfig(baseDir);
  const provider = config.chatProvider ?? config.aiProvider ?? "gemini";
  const model = resolveLanguageModel({
    provider,
    modelId: config.chatModel,
    geminiApiKey: config.geminiApiKey,
    bedrockApiKey: config.bedrockApiKey,
    bedrockRegion: config.bedrockRegion,
    feature: "chat",
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = await createMcpServer({ baseDir });
  await mcpServer.connect(serverTransport);
  const client = await createMCPClient({
    transport: clientTransport,
  });

  const roots = config.roots && config.roots.length > 0 ? config.roots : [config.root];

  try {
    const inventoryTools = await client.tools();
    const readOnlyTools = Object.fromEntries(
      Object.entries(inventoryTools).filter(([name]) => READ_ONLY_MCP_TOOLS.has(name)),
    );
    const tools: ToolSet = { ...readOnlyTools };

    // Synchronous root terminal search tool for finding missing/unmanifested projects
    tools.search_root_terminal = tool({
      description:
        "Execute a read-only terminal search command (find, grep, rg, ls, tree, file, stat, git status/log, etc.) in the workspace root directory. Useful to locate missing projects, unmanifested codebases, or inspect folder structures. Executes synchronously and returns output.",
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .max(4000)
          .describe(
            "Exact search command pipeline (e.g. 'find . -maxdepth 3 -name \"*.json\" | grep -v node_modules | head -n 30')",
          ),
        rootPath: z
          .string()
          .optional()
          .describe(
            "Optional workspace root directory path to search within. Defaults to the primary workspace root.",
          ),
      }),
      execute: async (input) => {
        let targetRoot = roots[0] ?? config.root;
        if (input.rootPath) {
          const reqPath = input.rootPath;
          const matched = roots.find(
            (r) => r === reqPath || resolve(r) === resolve(reqPath),
          );
          if (!matched) {
            return {
              error: `Specified rootPath '${reqPath}' is not in configured workspace roots: ${roots.join(", ")}`,
            };
          }
          targetRoot = matched;
        }

        const allowedPatterns =
          config.allowedRootBashPatterns ?? DEFAULT_ALLOWED_ROOT_BASH_PATTERNS;
        const validation = validateSearchCommand(input.command, allowedPatterns);
        if (!validation.valid) {
          return {
            error: validation.error,
          };
        }

        try {
          const { stdout, stderr } = await execAsync(input.command, {
            cwd: targetRoot,
            timeout: 30_000,
            maxBuffer: 100 * 1024,
            shell: "/bin/bash",
            env: getExecutionEnv(),
          });
          return {
            cwd: targetRoot,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          };
        } catch (err: unknown) {
          const execErr = err as {
            stdout?: string;
            stderr?: string;
            message?: string;
            killed?: boolean;
          };
          return {
            cwd: targetRoot,
            stdout: execErr.stdout ? execErr.stdout.trim() : "",
            stderr: execErr.stderr
              ? execErr.stderr.trim()
              : execErr.message || "Command execution failed",
            timedOut: execErr.killed || false,
          };
        }
      },
    });

    if (request.projectId) {
      tools.run_bash_command = tool({
        description:
          "Execute one exact bash command in the selected project. Use only when the user explicitly asks to run a command.",
        inputSchema: z.object({
          command: z
            .string()
            .min(1)
            .max(12_000)
            .describe("Exact bash command to execute in the selected project"),
        }),
        execute: async (input) => ({
          launchRequested: true,
          kind: "bash",
          projectId: request.projectId,
          command: input.command,
        }),
      });
      tools.run_coding_agent = tool({
        description:
          "Run one locally installed coding CLI in the selected project. Use only when the user explicitly asks for coding-agent work.",
        inputSchema: z.object({
          prompt: z.string().min(1).max(12_000).describe("Focused task for the coding agent"),
          agent: z
            .enum(["codex", "opencode", "claude", "agy", "gemini"])
            .optional()
            .describe("Preferred coding CLI"),
        }),
        execute: async (input) => ({
          launchRequested: true,
          kind: "coding",
          projectId: request.projectId,
          prompt: input.prompt,
          agent: input.agent ?? request.preferredAgent,
        }),
      });
    }
    const result = streamText({
      model,
      messages: request.messages
        .filter((message) => message.content.trim().length > 0)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
      instructions: instructions(request.projectId, request.preferredAgent, roots),
      tools,
      stopWhen: stepCountIs(20),
      abortSignal: signal,
    });

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        emit({ type: "text", text: part.text });
      } else if (part.type === "reasoning-delta") {
        emit({ type: "reasoning", text: part.text });
      } else if (part.type === "tool-call") {
        emit({
          type: "tool-call",
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          input: part.input,
        });
      } else if (part.type === "tool-result") {
        emit({
          type: "tool-result",
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          input: part.input,
          output: part.output,
        });
      } else if (part.type === "tool-error") {
        emit({
          type: "tool-result",
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          input: part.input,
          output: {
            error:
              part.error instanceof Error
                ? part.error.message
                : typeof part.error === "string"
                  ? part.error
                  : JSON.stringify(part.error),
          },
        });
      } else if (part.type === "error") {
        emit({
          type: "error",
          text: part.error instanceof Error ? part.error.message : "The model stream failed",
        });
      }
    }
  } finally {
    await client.close();
    await mcpServer.close();
  }
}
