import { useState } from "react";
import type { RecentSessionSummary, ToolCapabilityResult } from "../../../../core/types.ts";
import { formatTimeAgo } from "../../../lib/format.ts";

interface SessionsTabProps {
  sessions: ToolCapabilityResult<RecentSessionSummary>;
  toolName: string;
  onNavigateToProject?: (projectId: string) => void;
  onViewTranscript: (session: RecentSessionSummary) => void;
}

export function SessionsTab({
  sessions,
  toolName,
  onNavigateToProject,
  onViewTranscript,
}: SessionsTabProps) {
  const [search, setSearch] = useState("");

  if (sessions.state === "unsupported") {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <div className="max-w-md rounded-xl border border-warning/30 bg-warning/5 p-6 text-left">
          <div className="flex items-center gap-2 text-warning">
            <svg className="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3 className="text-sm font-semibold text-ink">Recent Sessions Unsupported</h3>
          </div>
          <p className="mt-2 text-xs text-muted leading-relaxed">
            {sessions.reason ?? `${toolName} sessions are unsupported in V1.`}
          </p>
        </div>
      </div>
    );
  }

  const filteredItems = sessions.items.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const titleMatch = item.title.toLowerCase().includes(q);
    const clientMatch = item.clientMode ? item.clientMode.toLowerCase().includes(q) : false;
    const projectMatch =
      item.projectAssociation?.kind === "known_project"
        ? (item.projectAssociation.name?.toLowerCase().includes(q) || item.projectAssociation.path?.toLowerCase().includes(q))
        : item.projectAssociation?.kind === "external_folder"
          ? item.projectAssociation.path?.toLowerCase().includes(q)
          : false;
    return titleMatch || clientMatch || projectMatch;
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
              placeholder="Search sessions…"
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
            {filteredItems.length} of {sessions.items.length} sessions
          </span>
          {sessions.truncated && (
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
              Capped at 50
            </span>
          )}
        </div>
      </div>

      {/* Sessions List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-xs text-muted">
            <p>No recent sessions found for {toolName}.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredItems.map((session) => {
              const ago = formatTimeAgo(session.lastActivityAt);
              return (
                <div
                  key={session.id}
                  className="rounded-lg border border-border bg-panel p-4 transition-colors hover:border-border-hover flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-ink truncate" title={session.title}>
                          {session.title}
                        </h4>
                        {session.clientMode && (
                          <span className="rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] text-muted font-medium">
                            {session.clientMode}
                          </span>
                        )}
                        {!session.transcriptAvailable && (
                          <span className="rounded-full bg-warning/10 border border-warning/20 px-2 py-0.5 text-[10px] text-warning font-medium">
                            Transcript Unavailable
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap text-xs text-muted mt-1">
                        {/* Project Association Pill */}
                        {session.projectAssociation?.kind === "known_project" ? (
                          <div className="flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] text-ink font-medium">
                            <span>Project: {session.projectAssociation.name ?? session.projectAssociation.projectId}</span>
                            {session.projectAssociation.projectId && onNavigateToProject && (
                              <button
                                type="button"
                                onClick={() => onNavigateToProject(session.projectAssociation!.projectId!)}
                                className="text-accent hover:underline cursor-pointer ml-1 font-medium"
                              >
                                Open in Projects &rarr;
                              </button>
                            )}
                          </div>
                        ) : session.projectAssociation?.kind === "external_folder" ? (
                          <span
                            className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] font-mono text-muted max-w-xs truncate"
                            title={session.projectAssociation.path}
                          >
                            {session.projectAssociation.path}
                          </span>
                        ) : (
                          <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] text-muted">
                            Projectless
                          </span>
                        )}

                        {ago && <span>&bull; {ago}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => onViewTranscript(session)}
                        className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-hover hover:border-border-hover transition-colors cursor-pointer"
                      >
                        View Transcript
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
