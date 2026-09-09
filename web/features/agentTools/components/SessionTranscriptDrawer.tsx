import { useEffect, useState, useCallback } from "react";
import type { GuidanceHistoryEntry, GuidanceHistoryPage, RecentSessionSummary } from "../../../../core/types.ts";
import { readAgentSessionTranscript } from "../../../apiClient.ts";

interface SessionTranscriptDrawerProps {
  session: RecentSessionSummary | null;
  onClose: () => void;
  onNavigateToProject?: (projectId: string) => void;
  onImproveGuidance?: (projectId: string, sessionId: string) => void;
}

function entryRoleLabel(entry: GuidanceHistoryEntry): string {
  if (entry.tool) {
    return `Tool: ${entry.tool.name} (${entry.tool.status})`;
  }
  if (entry.role === "user") {
    return "User Prompt";
  }
  if (entry.role === "assistant") {
    return "Assistant Response";
  }
  return `${entry.role ?? "record"} ${entry.type}`;
}

export function SessionTranscriptDrawer({
  session,
  onClose,
  onNavigateToProject,
  onImproveGuidance,
}: SessionTranscriptDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<GuidanceHistoryPage | null>(null);
  const [entries, setEntries] = useState<GuidanceHistoryEntry[]>([]);

  const loadInitialTranscript = useCallback(async (sessionId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await readAgentSessionTranscript(sessionId);
      setPage(res);
      setEntries(res.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLoadMore = async () => {
    if (!session || !page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await readAgentSessionTranscript(session.id, page.nextCursor);
      setPage(res);
      setEntries((prev) => [...prev, ...res.entries]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!session) {
      setPage(null);
      setEntries([]);
      setError(null);
      return;
    }
    void loadInitialTranscript(session.id);
  }, [session, loadInitialTranscript]);

  useEffect(() => {
    if (!session) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [session, onClose]);

  if (!session) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-150">
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Drawer Panel */}
      <aside className="relative z-10 flex h-full w-full max-w-2xl flex-col bg-panel shadow-2xl border-l border-border animate-in slide-in-from-right duration-200">
        {/* Header */}
        <header className="flex items-start justify-between border-b border-border p-5">
          <div className="min-w-0 flex-1 pr-4">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] text-muted font-medium">
                {session.clientMode ?? session.toolId}
              </span>
              {session.projectAssociation?.kind === "known_project" && (
                <div className="flex items-center gap-1 text-xs text-muted">
                  <span>Project: {session.projectAssociation.name ?? session.projectAssociation.projectId}</span>
                  {session.projectAssociation.projectId && onNavigateToProject && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onNavigateToProject(session.projectAssociation!.projectId!);
                      }}
                      className="text-accent hover:underline cursor-pointer ml-1 font-medium"
                    >
                      Open &rarr;
                    </button>
                  )}
                </div>
              )}
            </div>
            <h3 className="text-base font-semibold text-ink leading-snug break-words">
              {session.title}
            </h3>
            {session.transcriptAvailable && session.projectAssociation?.kind === "known_project" && session.projectAssociation.projectId && onImproveGuidance && (
              <button
                type="button"
                className="btn btn-secondary mt-3 px-3 py-1.5 text-xs"
                onClick={() => {
                  onClose();
                  onImproveGuidance(session.projectAssociation!.projectId!, session.id);
                }}
              >
                Improve agent guidance
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink transition-colors cursor-pointer flex-shrink-0"
            aria-label="Close transcript drawer"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center p-12 text-center text-xs text-muted">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent mb-3" />
              <p>Loading session transcript…</p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-xs text-danger">
              <p className="font-medium">Failed to load transcript</p>
              <p className="mt-1 opacity-90">{error}</p>
            </div>
          )}

          {!loading && page && page.available === false && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-xs text-warning">
              <p className="font-semibold">Local transcript unavailable</p>
              <p className="mt-1 opacity-90 leading-relaxed">
                {page.reason ?? "The local session transcript could not be found or read from disk."}
              </p>
            </div>
          )}

          {!loading && entries.length === 0 && (!page || page.available !== false) && !error && (
            <div className="flex flex-col items-center justify-center p-12 text-center text-xs text-muted">
              <p>No messages found in this session transcript.</p>
            </div>
          )}

          {!loading && entries.length > 0 && (
            <div className="space-y-3">
              {entries.map((entry) => {
                const isUser = entry.role === "user";
                const isAssistant = entry.role === "assistant";
                const isTool = Boolean(entry.tool);

                return (
                  <div
                    key={entry.id}
                    className={`rounded-lg border p-3.5 text-xs transition-colors ${
                      isUser
                        ? "border-accent/30 bg-accent/5 ml-4"
                        : isAssistant
                          ? "border-border bg-surface mr-4"
                          : isTool
                            ? "border-border/70 bg-panel/80 mx-2"
                            : "border-border bg-surface"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5 text-[11px]">
                      <span className={`font-semibold ${isUser ? "text-accent" : isAssistant ? "text-ink" : "text-muted"}`}>
                        {entryRoleLabel(entry)}
                      </span>
                      {entry.createdAt && (
                        <span className="text-[10px] text-muted">
                          {new Date(entry.createdAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>

                    {entry.text && (
                      <div className="whitespace-pre-wrap leading-relaxed text-ink/90 font-mono text-[11px]">
                        {entry.text}
                      </div>
                    )}

                    {entry.tool && (
                      <div className="space-y-2 mt-2">
                        {entry.tool.input && (
                          <div>
                            <span className="text-[10px] font-medium text-muted uppercase">Input:</span>
                            <pre className="mt-0.5 rounded bg-surface p-2 text-[10px] font-mono text-muted overflow-x-auto whitespace-pre-wrap max-h-48 border border-border">
                              {entry.tool.input}
                            </pre>
                          </div>
                        )}
                        {entry.tool.error && (
                          <div>
                            <span className="text-[10px] font-medium text-danger uppercase">Error:</span>
                            <pre className="mt-0.5 rounded bg-danger/10 p-2 text-[10px] font-mono text-danger overflow-x-auto whitespace-pre-wrap max-h-48 border border-danger/20">
                              {entry.tool.error}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {entry.unavailable && (
                      <p className="mt-2 text-[11px] text-warning italic">
                        {entry.unavailable}
                      </p>
                    )}
                  </div>
                );
              })}

              {page?.incomplete && (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
                  {page.incomplete}
                </div>
              )}

              {page?.hasMore && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="rounded-md border border-border bg-surface px-4 py-2 text-xs font-medium text-ink hover:bg-surface-hover hover:border-border-hover transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {loadingMore ? "Loading more messages…" : "Load more messages"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
