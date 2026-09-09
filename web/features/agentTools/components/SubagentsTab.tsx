import { useState } from "react";
import type { GlobalResource, ToolCapabilityResult } from "../../../../core/types.ts";

interface SubagentsTabProps {
  subagents: ToolCapabilityResult<GlobalResource>;
  toolName: string;
  onPreview: (ref: string, title: string) => void;
}

export function SubagentsTab({ subagents, toolName, onPreview }: SubagentsTabProps) {
  const [search, setSearch] = useState("");
  const emptyDescription = toolName === "Codex"
    ? "Save standalone TOML sub-agent definitions in ~/.codex/agents/ with name, description, and developer_instructions fields."
    : `${toolName} does not provide standalone global sub-agent definition files in V1.`;

  if (subagents.state === "unsupported") {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <div className="max-w-lg rounded-xl border border-border bg-panel p-6 shadow-xs text-left">
          <div className="flex items-center gap-2 text-warning mb-3">
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3 className="text-sm font-semibold text-ink">Sub-agents Not Supported</h3>
          </div>
          <p className="text-xs text-muted leading-relaxed">
            {subagents.reason || `${toolName} does not provide standalone global sub-agent definition files in V1.`}
          </p>
        </div>
      </div>
    );
  }

  const filteredItems = subagents.items.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      (item.description && item.description.toLowerCase().includes(q)) ||
      (item.modelRestriction && item.modelRestriction.toLowerCase().includes(q)) ||
      (item.reasoningEffort && item.reasoningEffort.toLowerCase().includes(q)) ||
      (item.sandboxMode && item.sandboxMode.toLowerCase().includes(q)) ||
      (item.toolRestrictions && item.toolRestrictions.some((t) => t.toLowerCase().includes(q)))
    );
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search & Header Bar */}
      <div className="flex items-center justify-between border-b border-border bg-panel px-6 py-3">
        <div className="flex items-center gap-3 flex-1 max-w-sm">
          <div className="relative flex items-center w-full">
            <svg
              className="absolute left-2.5 h-3.5 w-3.5 text-muted pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sub-agents…"
              className="w-full rounded-md border border-border bg-surface py-1 pl-8 pr-3 text-xs text-ink placeholder:text-muted focus:border-info focus:outline-none transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 text-muted hover:text-ink cursor-pointer"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <span className="text-xs text-muted">
          {filteredItems.length} of {subagents.items.length} sub-agents
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {subagents.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="max-w-md rounded-xl border border-border bg-panel p-6">
              <svg
                className="mx-auto h-8 w-8 text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <h4 className="mt-3 text-sm font-semibold text-ink">No sub-agent definitions found</h4>
              <p className="mt-1 text-xs text-muted">
                {emptyDescription}
              </p>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted">
            No sub-agents match "{search}".
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredItems.map((agent) => (
              <div
                key={agent.id}
                className="flex flex-col justify-between rounded-xl border border-border bg-panel p-4 hover:border-info/40 transition-colors shadow-xs"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold text-ink">{agent.name}</h4>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        agent.origin === "user"
                          ? "border-good/30 bg-good/10 text-good"
                          : "border-info/30 bg-info/10 text-info"
                      }`}
                    >
                      {agent.origin}
                    </span>
                  </div>

                  {agent.description ? (
                    <p className="mt-2 text-xs text-muted leading-relaxed line-clamp-3">
                      {agent.description}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs italic text-muted/60">No description specified</p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/50">
                    {agent.modelRestriction && (
                      <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-accent">
                        model: {agent.modelRestriction}
                      </span>
                    )}
                    {agent.reasoningEffort && (
                      <span className="rounded-md border border-info/30 bg-info/10 px-2 py-0.5 font-mono text-[10px] text-info">
                        reasoning: {agent.reasoningEffort}
                      </span>
                    )}
                    {agent.sandboxMode && (
                      <span className="rounded-md border border-good/30 bg-good/10 px-2 py-0.5 font-mono text-[10px] text-good">
                        sandbox: {agent.sandboxMode}
                      </span>
                    )}
                    {agent.toolRestrictions && agent.toolRestrictions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        {agent.toolRestrictions.map((tool) => (
                          <span
                            key={tool}
                            className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between pt-3 border-t border-border">
                  <span className="font-mono text-[10px] text-muted truncate max-w-[200px]" title={agent.path}>
                    {agent.path}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPreview(agent.id, agent.name)}
                    className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-hover hover:border-info/50 transition-colors cursor-pointer"
                  >
                    Preview
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
