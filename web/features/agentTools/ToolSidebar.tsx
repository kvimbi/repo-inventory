import type { AgentToolId, AgentToolSummary } from "../../../core/types.ts";

interface ToolSidebarProps {
  tools: AgentToolSummary[];
  selectedToolId: AgentToolId | null;
  onSelectTool: (id: AgentToolId) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function ToolSidebar({
  tools,
  selectedToolId,
  onSelectTool,
  searchQuery,
  onSearchChange,
}: ToolSidebarProps) {
  const filteredTools = tools.filter((tool) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return tool.name.toLowerCase().includes(q) || tool.id.toLowerCase().includes(q);
  });

  return (
    <aside className="flex w-72 flex-col border-r border-border bg-panel/60 select-none shrink-0">
      {/* Search Input Bar */}
      <div className="border-b border-border p-3">
        <div className="relative flex items-center">
          <svg
            className="absolute left-2.5 h-3.5 w-3.5 text-muted pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter agent tools…"
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-xs text-ink placeholder:text-muted focus:border-info focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 text-muted hover:text-ink cursor-pointer"
              title="Clear search"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Tools List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredTools.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted">No agent tools match search.</div>
        ) : (
          filteredTools.map((tool) => {
            const isSelected = selectedToolId === tool.id;
            const isInstalled = tool.installation.installed;

            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => onSelectTool(tool.id)}
                className={`group flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                  isSelected
                    ? "border-accent/40 bg-panel-hover text-ink shadow-xs"
                    : "border-transparent bg-transparent hover:border-border/60 hover:bg-panel-hover/70 text-muted hover:text-ink"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      isInstalled ? "bg-good shadow-[0_0_8px_rgba(63,185,80,0.4)]" : "bg-muted/40"
                    }`}
                    title={isInstalled ? "Installed" : "Not detected on host"}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold tracking-tight truncate text-ink">
                      {tool.name}
                    </span>
                    <span className="text-[11px] font-mono text-muted truncate">
                      {tool.id}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {tool.warningCount > 0 && (
                    <span
                      className="rounded-full bg-warn/15 border border-warn/30 px-1.5 py-0.5 text-[10px] font-mono text-warn"
                      title={`${tool.warningCount} warning(s)`}
                    >
                      {tool.warningCount}
                    </span>
                  )}
                  {isInstalled ? (
                    tool.installation.version ? (
                      <span
                        className="rounded bg-surface border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted max-w-[90px] truncate"
                        title={`Version: ${tool.installation.version}`}
                      >
                        {tool.installation.version}
                      </span>
                    ) : (
                      <span className="rounded bg-good/10 border border-good/30 px-1.5 py-0.5 text-[10px] text-good">
                        ready
                      </span>
                    )
                  ) : (
                    <span className="rounded bg-surface border border-border/60 px-1.5 py-0.5 text-[10px] text-muted/80">
                      missing
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
