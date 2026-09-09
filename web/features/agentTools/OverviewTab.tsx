import type { AgentToolDetails, ToolCapabilityState } from "../../../core/types.ts";
import { formatBytes, formatTimestamp } from "../../lib/format.ts";

interface OverviewTabProps {
  details: AgentToolDetails;
}

function stateBadge(state: ToolCapabilityState) {
  switch (state) {
    case "ready":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-good/10 border border-good/30 px-2 py-0.5 text-[11px] font-medium text-good">
          <span className="h-1.5 w-1.5 rounded-full bg-good" />
          ready
        </span>
      );
    case "missing":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-warn/10 border border-warn/30 px-2 py-0.5 text-[11px] font-medium text-warn">
          <span className="h-1.5 w-1.5 rounded-full bg-warn" />
          missing
        </span>
      );
    case "unsupported":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-surface border border-border px-2 py-0.5 text-[11px] font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-muted/60" />
          unsupported
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-critical/10 border border-critical/30 px-2 py-0.5 text-[11px] font-medium text-critical">
          <span className="h-1.5 w-1.5 rounded-full bg-critical" />
          error
        </span>
      );
  }
}

export function OverviewTab({ details }: OverviewTabProps) {
  const { summary, configuredRoots, configurations, skills, subagents, instructions, mcpServers, recentSessions } = details;
  const { installation } = summary;

  const capabilitiesList = [
    {
      key: "skills",
      label: "Skills",
      state: skills.state,
      itemsCount: skills.items.length,
      reason: skills.reason,
      description: "Global agent skills and capabilities",
    },
    {
      key: "subagents",
      label: "Sub-agents",
      state: subagents.state,
      itemsCount: subagents.items.length,
      reason: subagents.reason,
      description: "Standalone sub-agent definitions and configurations",
    },
    {
      key: "instructions",
      label: "Instructions",
      state: instructions.state,
      itemsCount: instructions.items.length,
      reason: instructions.reason,
      description: "Global agent prompts, instructions, and rules",
    },
    {
      key: "mcp",
      label: "MCP Servers",
      state: mcpServers.state,
      itemsCount: mcpServers.items.length,
      reason: mcpServers.reason,
      description: "Declared Model Context Protocol server endpoints",
    },
    {
      key: "config",
      label: "Configuration",
      state: summary.capabilities.config,
      itemsCount: configurations.filter((c) => c.exists).length,
      reason: undefined,
      description: "Global tool settings, profiles, and runtime configuration",
    },
    {
      key: "sessions",
      label: "Recent Sessions",
      state: recentSessions.state,
      itemsCount: recentSessions.items.length,
      reason: recentSessions.reason,
      description: "Historical agent runs, transcripts, and session logs",
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto">
      {/* Top Banner: Status summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border bg-panel p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
              installation.installed
                ? "border-good/30 bg-good/10 text-good"
                : "border-border bg-surface text-muted"
            }`}
          >
            {installation.installed ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">{summary.name}</h3>
              <span className="rounded bg-surface border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {summary.id}
              </span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              {installation.installed
                ? `Detected on system ${installation.version ? `(version ${installation.version})` : ""}`
                : "Not detected on host candidate paths or PATH"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted border-t sm:border-t-0 pt-3 sm:pt-0 border-border">
          <span className="text-[11px]">Last probed:</span>
          <span className="font-mono text-[11px] text-ink">{formatTimestamp(installation.probedAt)}</span>
        </div>
      </div>

      {/* Grid: Installation Details & Configured Roots */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Installation details card */}
        <div className="rounded-xl border border-border bg-panel p-4 flex flex-col gap-3">
          <h4 className="text-xs font-semibold text-ink tracking-tight uppercase text-muted">
            Installation Details
          </h4>

          <div className="space-y-2 text-xs">
            <div className="flex items-start justify-between gap-2 border-b border-border-subtle pb-2">
              <span className="text-muted shrink-0">Executable Path:</span>
              <span
                className="font-mono text-[11px] text-ink truncate text-right max-w-[280px]"
                title={installation.executablePath ?? "Not found"}
              >
                {installation.executablePath ?? <span className="text-muted/60">Not found</span>}
              </span>
            </div>

            <div className="flex items-start justify-between gap-2 border-b border-border-subtle pb-2">
              <span className="text-muted shrink-0">App Bundle:</span>
              <span
                className="font-mono text-[11px] text-ink truncate text-right max-w-[280px]"
                title={installation.appPath ?? "None"}
              >
                {installation.appPath ?? <span className="text-muted/60">None</span>}
              </span>
            </div>

            <div className="flex items-start justify-between gap-2 border-b border-border-subtle pb-2">
              <span className="text-muted shrink-0">Probed Version:</span>
              <span className="font-mono text-[11px] text-ink">
                {installation.version ?? <span className="text-muted/60">Unresolved</span>}
              </span>
            </div>

            <div className="pt-1">
              <span className="text-muted block mb-1.5 text-[11px]">Checked Candidate Paths:</span>
              <div className="rounded-lg border border-border-subtle bg-surface/70 p-2 space-y-1 max-h-36 overflow-y-auto">
                {installation.candidatePaths.map((candPath) => {
                  const isMatch = candPath === installation.executablePath;
                  return (
                    <div
                      key={candPath}
                      className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted hover:text-ink"
                    >
                      <span className="truncate" title={candPath}>
                        {candPath}
                      </span>
                      {isMatch && (
                        <span className="shrink-0 rounded bg-good/20 text-good border border-good/40 px-1 text-[9px]">
                          active
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Configured Roots & Files Card */}
        <div className="rounded-xl border border-border bg-panel p-4 flex flex-col gap-3">
          <h4 className="text-xs font-semibold text-ink tracking-tight uppercase text-muted">
            Configured Roots & Files
          </h4>

          <div className="space-y-3 text-xs">
            <div>
              <span className="text-muted block mb-1.5 text-[11px]">Discovered Roots:</span>
              <div className="space-y-1">
                {configuredRoots.map((rootPath) => (
                  <div
                    key={rootPath}
                    className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface/70 px-2.5 py-1.5 font-mono text-[11px] text-ink truncate"
                    title={rootPath}
                  >
                    <svg
                      className="h-3.5 w-3.5 text-info shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="truncate">{rootPath}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="text-muted block mb-1.5 text-[11px]">Configuration References:</span>
              <div className="space-y-1">
                {configurations.map((cfg) => (
                  <div
                    key={cfg.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface/70 px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[11px] text-ink font-medium truncate" title={cfg.path}>
                        {cfg.label}
                      </span>
                      {cfg.sizeBytes !== undefined && (
                        <span className="text-[10px] text-muted font-mono">
                          ({formatBytes(cfg.sizeBytes)})
                        </span>
                      )}
                    </div>
                    <div>
                      {cfg.exists ? (
                        <span className="rounded bg-good/15 text-good border border-good/30 px-1.5 py-0.2 text-[10px]">
                          found
                        </span>
                      ) : (
                        <span className="rounded bg-surface border border-border px-1.5 py-0.2 text-[10px] text-muted">
                          absent
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Capability Matrix Grid */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold text-ink tracking-tight uppercase text-muted">
          Capability Matrix
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {capabilitiesList.map((cap) => (
            <div
              key={cap.key}
              className="flex flex-col justify-between rounded-xl border border-border bg-panel p-3.5 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-ink">{cap.label}</span>
                  {stateBadge(cap.state)}
                </div>
                <p className="text-[11px] text-muted leading-relaxed">{cap.description}</p>
              </div>

              <div className="mt-3 pt-2.5 border-t border-border-subtle">
                {cap.reason ? (
                  <p className="text-[10px] text-muted/90 italic leading-snug">{cap.reason}</p>
                ) : (
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    <span>Discovered items</span>
                    <span className="font-mono font-medium text-ink">{cap.itemsCount}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
