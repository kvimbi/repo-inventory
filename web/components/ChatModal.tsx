import { useEffect, useMemo, useState } from "react";
import type { Project } from "../../core/types.ts";
import {
  fetchCodingAgents,
  fetchConfig,
  startBashRun,
  startCodingRun,
  stopCodingRun,
  subscribeCodingRunEvents,
  streamProjectChat,
  type CodingAgent,
  type CodingRun,
  type ChatStreamEvent,
} from "../apiClient.ts";
import {
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_BEDROCK_CHAT_MODEL,
  GEMINI_MODEL_PRESETS,
  BEDROCK_MODEL_PRESETS,
} from "../../core/aiModels.ts";
import { renderMarkdown } from "../lib/markdown.ts";

interface ChatToolActivity {
  id: string;
  toolCallId?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  status: "running" | "completed";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  tools: ChatToolActivity[];
}

function ThoughtProcess({ reasoning, isStreaming }: { reasoning: string; isStreaming?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="my-2 overflow-hidden rounded border border-border-subtle bg-surface/50 text-xs">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-muted hover:bg-panel-hover hover:text-ink transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-block text-[9px] transition-transform duration-150 ${
              isExpanded ? "rotate-90" : "rotate-0"
            }`}
            aria-hidden="true"
          >
            ▶
          </span>
          <span className="font-medium text-xs">
            {isStreaming ? "Thinking…" : "Thought process"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isStreaming && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-info animate-pulse" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border-subtle bg-panel/30 p-3 space-y-2">
          <div className="flex items-center justify-end">
            <CopyButton text={reasoning} />
          </div>
          <div className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted/90 select-text max-h-60 overflow-auto">
            {reasoning}
          </div>
        </div>
      )}
    </div>
  );
}

function formatPayload(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy(event: React.MouseEvent) {
    event.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="btn btn-ghost px-1.5 py-0.5 text-[10px] text-muted hover:text-ink transition-colors"
      title="Copy to clipboard"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

interface ToolActivityItemProps {
  activity: ChatToolActivity;
  isExpanded: boolean;
  onToggle: () => void;
}

function ToolActivityItem({ activity, isExpanded, onToggle }: ToolActivityItemProps) {
  const inputStr = activity.input !== undefined ? formatPayload(activity.input) : "";
  const outputStr = activity.output !== undefined ? formatPayload(activity.output) : "";

  return (
    <div className="overflow-hidden rounded border border-border-subtle bg-surface transition-colors">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-panel-hover"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-block text-[9px] text-muted transition-transform duration-150 ${
              isExpanded ? "rotate-90" : "rotate-0"
            }`}
            aria-hidden="true"
          >
            ▶
          </span>
          <span className="font-mono font-medium text-ink truncate">{activity.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={activity.status === "completed" ? "text-good" : "text-info flex items-center gap-1.5"}>
            {activity.status === "running" && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-info animate-pulse" />
            )}
            {activity.status === "completed" ? "Completed" : "Working"}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border-subtle bg-panel/50 p-3 space-y-3 text-xs">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Input</span>
              {inputStr && <CopyButton text={inputStr} />}
            </div>
            {activity.input !== undefined ? (
              <pre className="max-h-48 overflow-auto rounded border border-border-subtle bg-surface p-2.5 font-mono text-[11px] leading-relaxed text-ink whitespace-pre-wrap break-all select-text">
                {inputStr}
              </pre>
            ) : (
              <div className="text-[11px] text-muted italic">No input arguments</div>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Output</span>
              {outputStr && <CopyButton text={outputStr} />}
            </div>
            {activity.output !== undefined ? (
              <pre className="max-h-60 overflow-auto rounded border border-border-subtle bg-surface p-2.5 font-mono text-[11px] leading-relaxed text-ink whitespace-pre-wrap break-all select-text">
                {outputStr}
              </pre>
            ) : activity.status === "running" ? (
              <div className="rounded border border-border-subtle bg-surface/50 p-2.5 text-[11px] text-muted italic">
                Running tool…
              </div>
            ) : (
              <div className="text-[11px] text-muted italic">No output returned</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolActivityList({ tools }: { tools: ChatToolActivity[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const allExpanded = tools.length > 0 && tools.every((t) => expandedIds.has(t.id));

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allExpanded) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(tools.map((t) => t.id)));
    }
  }

  return (
    <div className="mt-3 space-y-1.5">
      {tools.length > 1 && (
        <div className="flex items-center justify-end pb-0.5">
          <button
            type="button"
            onClick={toggleAll}
            className="btn btn-ghost px-1.5 py-0.5 text-[10px] text-muted hover:text-ink transition-colors"
          >
            {allExpanded ? "Collapse all tools" : "Unroll all tools"}
          </button>
        </div>
      )}
      {tools.map((activity) => (
        <ToolActivityItem
          key={activity.id}
          activity={activity}
          isExpanded={expandedIds.has(activity.id)}
          onToggle={() => toggleExpand(activity.id)}
        />
      ))}
    </div>
  );
}

interface CodingRunRequest {
  kind: "coding";
  projectId: string;
  prompt: string;
  agent?: CodingAgent["id"];
}

interface BashRunRequest {
  kind: "bash";
  projectId: string;
  command: string;
}

type RunRequest = CodingRunRequest | BashRunRequest;

interface ChatModalProps {
  projects: Project[];
  selectedProject: Project | null;
  onClose: () => void;
}

function newId() {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function projectLabel(project: Project) {
  return project.annotation.alias ? `${project.annotation.alias} (${project.name})` : project.name;
}

export function ChatModal({ projects, selectedProject, onClose }: ChatModalProps) {
  const [scopeId, setScopeId] = useState<string>(selectedProject?.id ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [agents, setAgents] = useState<CodingAgent[]>([]);
  const [preferredAgent, setPreferredAgent] = useState<CodingAgent["id"] | "">("");
  const [composerMode, setComposerMode] = useState<"chat" | "delegate">("chat");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<CodingRun | null>(null);
  const [copiedConversation, setCopiedConversation] = useState(false);
  const [assistantLabel, setAssistantLabel] = useState("AI Assistant");

  async function handleCopyConversation() {
    if (messages.length === 0) return;
    try {
      const payload = JSON.stringify(messages, null, 2);
      await navigator.clipboard.writeText(payload);
      setCopiedConversation(true);
      setTimeout(() => setCopiedConversation(false), 1500);
    } catch {
      // ignore clipboard error
    }
  }

  const scopedProject = useMemo(
    () => projects.find((project) => project.id === scopeId) ?? null,
    [projects, scopeId],
  );

  useEffect(() => {
    fetchConfig()
      .then((cfg) => {
        const provider = cfg.chatProvider ?? cfg.aiProvider ?? "gemini";
        const defaultModel =
          provider === "bedrock" ? DEFAULT_BEDROCK_CHAT_MODEL : DEFAULT_GEMINI_CHAT_MODEL;
        const modelId = cfg.chatModel || defaultModel;
        const presets = provider === "bedrock" ? BEDROCK_MODEL_PRESETS : GEMINI_MODEL_PRESETS;
        const matched = presets.find((p) => p.id === modelId);
        setAssistantLabel(matched ? matched.label.replace(/\s*\([^)]*\)/, "") : modelId);
      })
      .catch(() => setAssistantLabel("AI Assistant"));
  }, []);

  useEffect(() => {
    fetchCodingAgents()
      .then((available) => {
        setAgents(available);
        setPreferredAgent((current) => current || available[0]?.id || "");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!scopeId) setComposerMode("chat");
  }, [scopeId]);

  useEffect(() => {
    if (!run) return;
    const unsubscribe = subscribeCodingRunEvents(run.id, (next) => {
      setRun(next);
      if (next.status !== "queued" && next.status !== "running") {
        setComposerMode("chat");
      }
    });
    return () => unsubscribe();
  }, [run?.id]);

  function updateAssistant(id: string, update: (message: ChatMessage) => ChatMessage) {
    setMessages((current) => current.map((message) => (message.id === id ? update(message) : message)));
  }

  async function startRun(request: RunRequest) {
    try {
      let started: CodingRun;
      if (request.kind === "bash") {
        started = await startBashRun(request.projectId, request.command);
      } else {
        const agent = request.agent ?? preferredAgent;
        if (!agent) throw new Error("No local coding CLI is available");
        started = await startCodingRun(request.projectId, agent, request.prompt);
      }
      setRun(started);
      setComposerMode("chat");
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function sendMessage() {
    const prompt = draft.trim();
    if (!prompt || streaming) return;
    const userMessage: ChatMessage = { id: newId(), role: "user", content: prompt, tools: [] };
    const assistantMessage: ChatMessage = { id: newId(), role: "assistant", content: "", tools: [] };

    if (composerMode === "delegate") {
      if (!scopeId) {
        setError("Choose one project before delegating a coding task");
        return;
      }
      if (!preferredAgent) {
        setError("No local coding CLI is available");
        return;
      }
      setMessages((current) => [
        ...current,
        userMessage,
        {
          ...assistantMessage,
          content: `Starting ${agents.find((agent) => agent.id === preferredAgent)?.label ?? "coding agent"} in ${scopedProject ? projectLabel(scopedProject) : "the selected project"}.`,
          tools: [
            {
              id: newId(),
              name: "run_coding_agent",
              input: { projectId: scopeId, prompt, agent: preferredAgent },
              output: { status: "started" },
              status: "completed",
            },
          ],
        },
      ]);
      setDraft("");
      setError(null);
      void startRun({ kind: "coding", projectId: scopeId, prompt, agent: preferredAgent });
      return;
    }

    const history = messages
      .filter((message) => message.content.trim().length > 0)
      .map(({ role, content }) => ({ role, content }))
      .concat({ role: "user", content: prompt });
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setDraft("");
    setError(null);
    setStreaming(true);

    try {
      await streamProjectChat(
        {
          messages: history,
          projectId: scopeId || undefined,
          preferredAgent: preferredAgent || undefined,
        },
        (event: ChatStreamEvent) => {
          if (event.type === "text" && event.text) {
            updateAssistant(assistantMessage.id, (message) => ({ ...message, content: message.content + event.text! }));
          }
          if (event.type === "reasoning" && event.text) {
            updateAssistant(assistantMessage.id, (message) => ({
              ...message,
              reasoning: (message.reasoning ?? "") + event.text!,
            }));
          }
          if (event.type === "tool-call" && event.toolName) {
            const toolCallId = event.toolCallId;
            updateAssistant(assistantMessage.id, (message) => ({
              ...message,
              tools: [
                ...message.tools,
                {
                  id: toolCallId || newId(),
                  toolCallId,
                  name: event.toolName!,
                  input: event.input,
                  status: "running",
                },
              ],
            }));
          }
          if (event.type === "tool-result" && event.toolName) {
            updateAssistant(assistantMessage.id, (message) => {
              let matched = false;
              const nextTools = message.tools.map((activity) => {
                if (matched) return activity;
                const isMatch = event.toolCallId
                  ? (activity.toolCallId ? activity.toolCallId === event.toolCallId : activity.name === event.toolName && activity.status === "running")
                  : activity.name === event.toolName && activity.status === "running";
                if (isMatch) {
                  matched = true;
                  return {
                    ...activity,
                    toolCallId: activity.toolCallId || event.toolCallId,
                    status: "completed" as const,
                    input: activity.input !== undefined ? activity.input : event.input,
                    output: event.output,
                  };
                }
                return activity;
              });

              if (!matched) {
                const lastIdx = [...nextTools].reverse().findIndex((a) => a.name === event.toolName);
                if (lastIdx !== -1) {
                  const actualIdx = nextTools.length - 1 - lastIdx;
                  nextTools[actualIdx] = {
                    ...nextTools[actualIdx],
                    status: "completed",
                    input: nextTools[actualIdx].input !== undefined ? nextTools[actualIdx].input : event.input,
                    output: event.output,
                  };
                }
              }

              return { ...message, tools: nextTools };
            });
            if (isRecord(event.output) && event.output.launchRequested === true && event.output.projectId === scopeId) {
              const output = event.output;
              if (event.toolName === "run_coding_agent" && output.kind === "coding" && typeof output.prompt === "string") {
                const agent = typeof output.agent === "string" && agents.some((available) => available.id === output.agent)
                  ? (output.agent as CodingAgent["id"])
                  : undefined;
                void startRun({ kind: "coding", projectId: scopeId, prompt: output.prompt, agent });
              }
              if (event.toolName === "run_bash_command" && output.kind === "bash" && typeof output.command === "string") {
                void startRun({ kind: "bash", projectId: scopeId, command: output.command });
              }
            }
          }
          if (event.type === "error") {
            setError(event.text ?? "The assistant could not finish this response");
          }
        },
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-5" role="dialog" aria-modal="true" aria-label="Ask about projects">
      <section className="flex h-[min(760px,calc(100vh-2.5rem))] w-[min(1080px,calc(100vw-2.5rem))] overflow-hidden rounded-lg border border-border bg-panel shadow-2xl">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center border-b border-border px-5 py-3.5">
            <div>
              <h2 className="text-sm font-semibold">Ask about projects</h2>
              <p className="mt-0.5 text-xs text-muted">Manage your inventory with {assistantLabel}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary px-2.5 py-1 text-xs"
                  onClick={() => void handleCopyConversation()}
                  title="Copy full conversation JSON to clipboard"
                >
                  {copiedConversation ? "Copied JSON" : "Copy conversation"}
                </button>
              )}
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={onClose}>Close</button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {messages.length === 0 && (
              <div className="max-w-lg pt-6 text-sm text-muted">
                Ask about project health, stack, documentation, or git state. Select one project to run a command or delegate a coding task there.
              </div>
            )}
            <div className="space-y-5">
              {messages.map((message) => (
                <article key={message.id} className={message.role === "user" ? "ml-auto max-w-[78%] rounded-md bg-info/15 px-4 py-3 text-sm" : "max-w-[92%] text-sm"}>
                  <div className="mb-1 text-xs font-medium text-muted">{message.role === "user" ? "You" : assistantLabel}</div>
                  {message.reasoning && (
                    <ThoughtProcess reasoning={message.reasoning} isStreaming={streaming && !message.content} />
                  )}
                  {message.tools.length > 0 && <ToolActivityList tools={message.tools} />}
                  {message.content ? (
                    message.role === "assistant" ? (
                      <div
                        className="prose-doc leading-6 mt-2.5"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                      />
                    ) : <p className="whitespace-pre-wrap leading-6">{message.content}</p>
                  ) : null}
                  {message.role === "assistant" && message.content === "" && !message.reasoning && message.tools.length === 0 && streaming && (
                    <p className="text-muted text-xs animate-pulse">Thinking…</p>
                  )}
                </article>
              ))}
            </div>
          </div>

          <form
            className="border-t border-border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage();
            }}
          >
            <textarea
              className="input-control block h-20 w-full resize-none px-3 py-2 text-sm"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={composerMode === "delegate"
                ? `Describe the coding task for ${scopedProject ? projectLabel(scopedProject) : "one project"}…`
                : scopedProject ? `Ask about ${projectLabel(scopedProject)}…` : "Ask about your projects…"}
              disabled={streaming}
            />
            <div className="mt-3 flex items-center gap-2">
              <select className="select-control min-w-0 flex-1 px-2 py-1.5 text-xs" value={scopeId} onChange={(event) => setScopeId(event.target.value)} disabled={streaming}>
                <option value="">All projects</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{projectLabel(project)}</option>)}
              </select>
              <select className="select-control w-36 px-2 py-1.5 text-xs" value={preferredAgent} onChange={(event) => setPreferredAgent(event.target.value as CodingAgent["id"])} disabled={streaming || agents.length === 0}>
                {agents.length === 0 && <option value="">No coding CLI</option>}
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
              </select>
              <button className="btn btn-secondary px-3 py-1.5 text-xs" type="button" disabled={streaming || !scopeId} title={scopeId ? "Delegate work to a coding CLI in this project" : "Select one project to delegate coding work"} onClick={() => setComposerMode((mode) => mode === "chat" ? "delegate" : "chat")}>{composerMode === "delegate" ? "Back to chat" : "Delegate"}</button>
              <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={streaming || !draft.trim()} type="submit">{streaming ? "Working…" : composerMode === "delegate" ? "Run task" : "Send"}</button>
            </div>
          </form>
        </div>

        <aside className="flex w-[330px] shrink-0 flex-col border-l border-border bg-surface">
          <header className="border-b border-border px-4 py-3.5">
            <h3 className="text-sm font-semibold">Context & runs</h3>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <section className="border-b border-border px-4 py-4">
              <h4 className="text-xs font-medium text-muted">Selected context</h4>
              {scopedProject ? (
                <div className="mt-3 text-sm">
                  <div className="font-medium">{projectLabel(scopedProject)}</div>
                  <div className="mt-1 text-xs text-muted">{scopedProject.relPath}</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(scopedProject.stack ?? []).slice(0, 4).map((stack) => <span key={stack} className="rounded border border-border px-1.5 py-0.5 text-xs text-muted">{stack}</span>)}
                    <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted">risk {scopedProject.risk}</span>
                  </div>
                </div>
              ) : <p className="mt-2 text-xs leading-5 text-muted">The assistant can compare all inventory projects. Choose one to keep questions and coding runs scoped.</p>}
            </section>

            <section className="px-4 py-4">
              <h4 className="text-xs font-medium text-muted">Running agent</h4>
              {run ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-sm"><span>{run.agent.label}</span><span className={run.status === "running" ? "text-info" : run.status === "succeeded" ? "text-good" : "text-warn"}>{run.status}</span></div>
                  <p className="mt-1 text-xs text-muted">{run.projectName}</p>
                  <pre className="mt-3 h-64 overflow-auto rounded border border-border bg-panel p-3 text-xs leading-5 whitespace-pre-wrap">{run.output || "Starting local coding agent…"}</pre>
                  {run.status === "running" && <button className="btn btn-secondary mt-3 w-full px-2 py-1.5 text-xs" onClick={() => void stopCodingRun(run.id).then(setRun).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))}>Stop run</button>}
                </div>
              ) : <p className="mt-2 text-xs leading-5 text-muted">Coding task output appears here while it runs.</p>}
            </section>
          </div>
          {error && <div className="border-t border-critical/40 bg-critical/10 px-4 py-3 text-xs text-critical">{error}</div>}
        </aside>
      </section>
    </div>
  );
}
