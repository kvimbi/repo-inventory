import { useState } from "react";
import type { ConfigurationReference, McpServerDeclaration, ToolCapabilityResult } from "../../../../core/types.ts";

interface McpTabProps {
  mcpServers: ToolCapabilityResult<McpServerDeclaration>;
  configurations?: ConfigurationReference[];
}

export function McpTab({ mcpServers, configurations = [] }: McpTabProps) {
  const [search, setSearch] = useState("");

  const configMap = new Map(configurations.map((c) => [c.id, c]));

  const filteredItems = mcpServers.items.filter((decl) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const config = configMap.get(decl.configRefId);
    const sourceLabel = config?.label ?? decl.sourcePath.split(/[/\\]/).pop() ?? decl.sourcePath;

    return (
      decl.name.toLowerCase().includes(q) ||
      decl.transport.toLowerCase().includes(q) ||
      decl.state.toLowerCase().includes(q) ||
      sourceLabel.toLowerCase().includes(q) ||
      decl.sourcePath.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search & Stats Bar */}
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
              placeholder="Search MCP servers by name, transport, state…"
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

        <div className="flex items-center gap-2 text-xs text-muted">
          <span>
            {filteredItems.length} of {mcpServers.items.length} servers
          </span>
          {mcpServers.truncated && (
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
              Capped at 100
            </span>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
        {/* Informative Disclaimer Banner */}
        <div className="flex items-start gap-3 rounded-lg border border-info/20 bg-info/5 p-4 text-xs text-ink/80">
          <svg
            className="h-4 w-4 shrink-0 text-info mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <div className="flex-1 space-y-1">
            <div className="font-semibold text-ink">Static Declaration Inventory</div>
            <p className="text-muted leading-relaxed">
              This inventory reflects static MCP server declarations discovered from global configuration files.
              It is read-only — no live MCP server processes are started and no network connections are made.
              Sensitive environment variables, command arguments, and authentication tokens are redacted by design.
              To configure or modify MCP servers, edit the respective files via the{" "}
              <span className="font-medium text-ink">Configuration</span> tab.
            </p>
          </div>
        </div>

        {/* State Display: Error, Empty, No Results, or Table */}
        {mcpServers.state === "error" ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="max-w-md rounded-xl border border-critical/30 bg-panel p-6">
              <svg
                className="mx-auto h-8 w-8 text-critical"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <h4 className="mt-3 text-sm font-semibold text-ink">Failed to discover MCP servers</h4>
              <p className="mt-1 text-xs text-critical leading-relaxed font-mono whitespace-pre-wrap">
                {mcpServers.reason || "Error reading or parsing MCP configuration files."}
              </p>
            </div>
          </div>
        ) : mcpServers.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="max-w-md rounded-xl border border-border bg-panel p-6">
              <svg
                className="mx-auto h-8 w-8 text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="m9 8 3 3-3 3M15 8h.01" />
              </svg>
              <h4 className="mt-3 text-sm font-semibold text-ink">No MCP servers declared</h4>
              <p className="mt-1 text-xs text-muted leading-relaxed">
                No global MCP server declarations were found in configuration files for this tool.
              </p>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted">
            No MCP servers match &quot;{search}&quot;.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-panel">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-surface/50 text-[11px] font-medium text-muted uppercase tracking-wider">
                  <th className="py-2.5 px-4">Server Name</th>
                  <th className="py-2.5 px-4">Transport</th>
                  <th className="py-2.5 px-4">State</th>
                  <th className="py-2.5 px-4">Source Configuration</th>
                  <th className="py-2.5 px-4 text-right">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredItems.map((decl) => {
                  const config = configMap.get(decl.configRefId);
                  const sourceLabel = config?.label ?? decl.sourcePath.split(/[/\\]/).pop() ?? decl.sourcePath;

                  return (
                    <tr key={decl.id} className="hover:bg-surface/50 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-medium text-ink">
                        {decl.name}
                      </td>
                      <td className="py-2.5 px-4">
                        {decl.transport === "stdio" ? (
                          <span className="inline-flex items-center rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-cyan-400">
                            stdio
                          </span>
                        ) : decl.transport === "sse" ? (
                          <span className="inline-flex items-center rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-purple-400">
                            sse
                          </span>
                        ) : decl.transport === "http" ? (
                          <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-400">
                            http
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px] font-medium text-muted">
                            unknown
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        {decl.state === "enabled" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-good/30 bg-good/10 px-2 py-0.5 text-[11px] font-medium text-good">
                            <span className="h-1.5 w-1.5 rounded-full bg-good" />
                            enabled
                          </span>
                        ) : decl.state === "disabled" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-muted/30 bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
                            <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                            disabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
                            unknown
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-muted">
                        <span
                          className="font-mono text-xs text-ink/90 cursor-help underline decoration-dotted decoration-muted underline-offset-2"
                          title={decl.sourcePath}
                        >
                          {sourceLabel}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right space-x-1.5">
                        {decl.conflict ? (
                          <span
                            className="inline-flex items-center rounded-full border border-critical/40 bg-critical/10 px-2 py-0.5 text-[10px] font-semibold text-critical tracking-wide uppercase"
                            title="Conflicting transport or state detected across multiple declarations of this server"
                          >
                            Conflict
                          </span>
                        ) : null}
                        {decl.duplicate ? (
                          <span
                            className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning tracking-wide uppercase"
                            title="Duplicate server declaration found across configuration files"
                          >
                            Duplicate
                          </span>
                        ) : null}
                        {!decl.conflict && !decl.duplicate ? (
                          <span className="text-muted text-[11px]">—</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
