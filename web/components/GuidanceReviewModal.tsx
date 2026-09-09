import { useEffect, useMemo, useState } from "react";
import type { GuidanceHistoryEntry, GuidanceHistorySourceDiagnostic, GuidanceReview, GuidanceReviewInfo, GuidanceSessionSummary, Project } from "../../core/types.ts";
import {
  applyGuidanceReview,
  cancelGuidanceReview,
  fetchGuidanceHistory,
  fetchGuidanceReview,
  fetchGuidanceReviewInfo,
  listGuidanceSessions,
  startGuidanceReview,
} from "../apiClient.ts";
import { formatTimeAgo } from "../lib/format.ts";

interface GuidanceReviewModalProps {
  project: Project;
  sessionId?: string;
  onClose: () => void;
}

function formatSessionUpdated(session: GuidanceSessionSummary): string {
  const timestamp = session.updatedAt ?? session.createdAt;
  if (!timestamp) return "Timestamp unavailable";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Timestamp unavailable";
  const ago = formatTimeAgo(date);
  const label = session.updatedAt ? "Updated" : "Created";
  const dateStr = date.toLocaleString();
  return ago ? `${label} ${dateStr} (${ago})` : `${label} ${dateStr}`;
}

function entryLabel(entry: GuidanceHistoryEntry): string {
  if (entry.tool) return `${entry.role ?? "agent"} tool ${entry.tool.name} (${entry.tool.status})`;
  return `${entry.role ?? "record"} ${entry.type}`;
}

const PROVIDER_LABELS: Record<string, string> = {
  all: "All",
  opencode: "OpenCode",
  claude: "Claude Code",
  cowork: "Claude Cowork",
  codex: "Codex",
};

export function GuidanceReviewModal({ project, sessionId, onClose }: GuidanceReviewModalProps) {
  const [sessions, setSessions] = useState<GuidanceSessionSummary[]>([]);
  const [sources, setSources] = useState<GuidanceHistorySourceDiagnostic[]>([]);
  const [info, setInfo] = useState<GuidanceReviewInfo | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [review, setReview] = useState<GuidanceReview | null>(null);
  const [chosenEdits, setChosenEdits] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<GuidanceHistoryEntry[]>([]);
  const [historySession, setHistorySession] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | undefined>();
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyIncomplete, setHistoryIncomplete] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listGuidanceSessions(project.id), fetchGuidanceReviewInfo(project.id)])
      .then(([nextSessions, nextInfo]) => {
        if (!cancelled) {
          setSessions(nextSessions.sessions);
          setSources(nextSessions.sources);
          setInfo(nextInfo);
          const requestedSession = sessionId
            ? nextSessions.sessions.find((session) => session.id === sessionId && session.available !== false)
            : undefined;
          setSelected(requestedSession ? new Set([requestedSession.id]) : new Set());
          setSelectedProvider("all");
          setHistory([]);
          setHistorySession(null);
        }
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, sessionId]);

  useEffect(() => {
    if (!review || review.status !== "running") return;
    const timer = window.setInterval(() => {
      fetchGuidanceReview(review.id).then(setReview).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [review]);

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const timeA = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      const timeB = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
      return timeB - timeA;
    });
  }, [sessions]);

  const availableProviders = useMemo(() => {
    const present = new Set(sessions.map((s) => s.sourceId));
    const list = ["all"];
    for (const key of ["opencode", "claude", "cowork", "codex"]) {
      if (present.has(key)) list.push(key);
    }
    return list;
  }, [sessions]);

  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: sessions.length };
    for (const s of sessions) {
      counts[s.sourceId] = (counts[s.sourceId] ?? 0) + 1;
    }
    return counts;
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    if (sessionId) return sortedSessions.filter((session) => session.id === sessionId);
    if (selectedProvider === "all") return sortedSessions;
    return sortedSessions.filter((s) => s.sourceId === selectedProvider);
  }, [sessionId, sortedSessions, selectedProvider]);

  const requestedSessionMissing = Boolean(sessionId && !loading && filteredSessions.length === 0);

  const selectedEditList = useMemo(() => review?.edits.filter((edit) => chosenEdits.has(edit.id)) ?? [], [review, chosenEdits]);
  const combinedPreview = useMemo(() => review ? renderCombinedPreview(review, selectedEditList.map((edit) => edit.id)) : "", [review, selectedEditList]);

  function toggleSession(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function showHistory(sessionId: string, cursor?: string) {
    setError(null);
    try {
      const page = await fetchGuidanceHistory(project.id, sessionId, cursor);
      setHistory((current) => cursor ? [...current, ...page.entries] : page.entries);
      setHistorySession(sessionId);
      setHistoryCursor(page.nextCursor);
      setHistoryHasMore(page.hasMore);
      setHistoryIncomplete(page.incomplete);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function begin() {
    setError(null);
    try {
      setReview(await startGuidanceReview(project.id, [...selected]));
      setHistory([]);
      setHistorySession(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function cancel() {
    if (!review) return;
    setReview(await cancelGuidanceReview(review.id));
  }

  async function apply() {
    if (!review || selectedEditList.length === 0) return;
    setError(null);
    try {
      setReview(await applyGuidanceReview(review.id, selectedEditList.map((edit) => edit.id)));
      setConfirming(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setConfirming(false);
    }
  }

  function returnToSessions() {
    if (review?.status === "applied") {
      setSelected(sessionId ? new Set([sessionId]) : new Set());
    }
    setReview(null);
    setConfirming(false);
    setChosenEdits(new Set());
    setError(null);
    fetchGuidanceReviewInfo(project.id).then(setInfo).catch(() => {});
  }

  function handleClose() {
    if (confirming) {
      setConfirming(false);
      return;
    }
    if (review && review.status !== "running") {
      returnToSessions();
      return;
    }
    onClose();
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (confirming) {
          setConfirming(false);
        } else if (review && review.status !== "running") {
          returnToSessions();
        } else {
          onClose();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirming, onClose, review]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <h2 className="text-lg font-bold text-ink">Improve agent guidance</h2>
            <p className="mt-1 text-xs text-muted">Checkout: <span className="font-mono text-ink">{project.path}</span></p>
            <p className="text-xs text-muted">Target: <span className="font-mono text-ink">{project.path}/AGENTS.md</span></p>
          </div>
          <button type="button" className="btn btn-ghost px-2 py-1" onClick={handleClose}>Close</button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {error && <div className="rounded border border-critical/40 bg-critical/10 p-3 text-sm text-critical">{error}</div>}
          {!review && (
            <>
              <p className="text-sm text-muted">{sessionId ? "Review this local coding-agent session" : "Choose local coding-agent sessions"} to send with the current AGENTS.md to <span className="font-mono text-ink">{info?.model ?? "the configured review model"}</span>. {!sessionId && "Related child sessions are shown separately and are never included automatically."}</p>
              {info && <p className="text-xs text-muted">{info.targetExisted ? "AGENTS.md currently exists." : "AGENTS.md is missing; it will be created only after you confirm a selected addition."} {info.hasProviderCredentials ? "Selected transcript content and AGENTS.md will be sent to this model provider." : "No provider credential is configured, so the review cannot start yet."}</p>}
              {loading ? <p className="text-sm text-muted">Loading local history…</p> : sessions.length === 0 ? <p className="text-sm text-muted">{sessionId ? "This session is no longer available for review in the associated checkout." : "No sessions are associated with this exact checkout."}</p> : (
                <div className="space-y-3">
                  {!sessionId && availableProviders.length > 2 && (
                    <div className="flex flex-wrap items-center gap-1.5 pb-1">
                      <span className="text-xs text-muted mr-1 font-medium">Provider:</span>
                      {availableProviders.map((provider) => {
                        const isSelected = selectedProvider === provider;
                        const count = providerCounts[provider] ?? 0;
                        return (
                          <button
                            key={provider}
                            type="button"
                            onClick={() => setSelectedProvider(provider)}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                              isSelected
                                ? "bg-ink text-surface font-semibold"
                                : "bg-surface/80 hover:bg-surface text-muted hover:text-ink border border-border"
                            }`}
                          >
                            {PROVIDER_LABELS[provider] ?? provider}
                            <span className={`ml-1 text-[10px] ${isSelected ? "opacity-90" : "text-muted"}`}>
                              ({count})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {filteredSessions.length === 0 ? (
                    <p className={`text-xs ${sessionId ? "text-warn" : "text-muted"}`}>{sessionId ? "This session is no longer available for review in the associated checkout." : "No sessions match the selected provider filter."}</p>
                  ) : (
                    <div className="space-y-2">
                      {filteredSessions.map((session) => (
                        <div key={session.id} className="flex items-start gap-3 rounded border border-border bg-surface/50 p-3">
                          {sessionId ? (
                            <span className="mt-0.5 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">Selected session</span>
                          ) : (
                            <input type="checkbox" checked={selected.has(session.id)} disabled={session.available === false} onChange={() => toggleSession(session.id)} className="mt-1" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-ink">{session.title} <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] font-normal text-muted">{session.client}</span> {session.relatedChild && <span className="text-xs font-normal text-warn">related child</span>}</div>
                            {session.directory && <div className="text-xs font-mono text-muted truncate">{session.directory}</div>}
                            <div className="text-xs text-muted">{formatSessionUpdated(session)} {session.parentId ? `· parent ${session.parentId}` : ""}</div>
                            {session.unavailableReason && <div className="mt-1 text-xs text-warn">{session.unavailableReason}</div>}
                            {session.limitations && <div className="mt-1 text-xs text-muted">{session.limitations}</div>}
                          </div>
                          <button type="button" disabled={session.available === false} className="btn btn-secondary px-2 py-1 text-xs" onClick={() => showHistory(session.id)}>Preview evidence</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {sources.filter((source) => source.state !== "ready").map((source) => <p key={source.id} className="rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">{source.id}: {source.reason ?? source.state}</p>)}
              {historySession && <EvidencePreview entries={history} incomplete={historyIncomplete} hasMore={historyHasMore} onLoadMore={historyCursor ? () => showHistory(historySession, historyCursor) : undefined} onClose={() => setHistorySession(null)} />}
            </>
          )}
          {review && (
            <>
              <div className="rounded border border-border bg-surface/50 p-3 text-sm">
                <div className="font-semibold text-ink">{review.status === "running" ? "Reviewing selected evidence" : `Review ${review.status}`}</div>
                <div className="mt-1 text-muted">{review.progress}</div>
                <div className="mt-1 text-xs text-muted">Model: {review.model} · {review.targetExisted ? "AGENTS.md existed at review start" : "AGENTS.md will be created only if an addition is applied"}</div>
              </div>
              {review.status === "running" && <button type="button" className="btn btn-secondary px-3 py-1.5 text-sm" onClick={cancel}>Cancel review</button>}
              {review.assessment && <div className="rounded border border-border bg-surface/40 p-4 text-sm space-y-2"><div><strong>Intent:</strong> {review.assessment.intent}</div><div><strong>Observed friction:</strong> {review.assessment.friction}</div><div><strong>Outcome evidence:</strong> {review.assessment.outcome}</div>{review.assessment.uncertainty && <div><strong>Uncertainty:</strong> {review.assessment.uncertainty}</div>}<div className="text-xs text-muted"><strong>Coverage:</strong> {review.coverage}</div>{review.limitations && <div className="text-xs text-muted"><strong>Limits:</strong> {review.limitations}</div>}</div>}
              {review.status === "completed" && review.edits.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted">No worthwhile durable guidance edits were proposed. Nothing has been written.</p>
                  <button type="button" className="btn btn-secondary px-4 py-2 text-sm" onClick={returnToSessions}>
                    Ok
                  </button>
                </div>
              )}
              {review.edits.map((edit) => (
                <label key={edit.id} className="block rounded border border-border bg-surface/50 p-4 cursor-pointer">
                  <div className="flex gap-3"><input type="checkbox" checked={chosenEdits.has(edit.id)} onChange={() => setChosenEdits((previous) => { const next = new Set(previous); if (next.has(edit.id)) next.delete(edit.id); else next.add(edit.id); return next; })} /><div><div className="font-semibold text-ink">{edit.title}</div><div className="mt-1 text-sm text-muted">{edit.rationale}</div><div className="mt-1 text-xs text-muted">Why it should last: {edit.usefulness}</div><pre className="mt-3 whitespace-pre-wrap rounded bg-black/20 p-2 text-xs text-ink">{edit.operation === "insert" ? `After: ${edit.anchor}\n\n${edit.newText}` : `Before:\n${edit.oldText}\n\nAfter:\n${edit.newText ?? "[delete]"}`}</pre><div className="mt-2 text-xs text-muted">Evidence: {edit.evidence.map((evidence) => evidence.entryId ?? evidence.callRef ?? evidence.sessionId).join(", ")}</div></div></div>
                  {edit.evidence.map((reference) => {
                    const key = reference.entryId ? `entry:${reference.entryId}` : reference.callRef && reference.section ? `tool:${reference.callRef}:${reference.section}` : "";
                    const retained = review.evidence[key];
                    return retained ? <details key={key} className="mt-2 text-xs text-muted"><summary>Inspect retained evidence ({retained.hash.slice(0, 12)})</summary><pre className="mt-1 whitespace-pre-wrap rounded bg-black/20 p-2 text-ink">{retained.excerpt}</pre></details> : null;
                  })}
                </label>
              ))}
              {review.status === "completed" && review.edits.length > 0 && !confirming && (
                <div className="flex items-center gap-2">
                  <button type="button" className="btn btn-primary px-4 py-2 text-sm" disabled={selectedEditList.length === 0} onClick={() => setConfirming(true)}>
                    Apply selected edits
                  </button>
                  <button type="button" className="btn btn-secondary px-3 py-2 text-sm" onClick={returnToSessions}>
                    Back to sessions
                  </button>
                </div>
              )}
              {confirming && <div className="rounded border border-warn/50 bg-warn/10 p-4"><p className="text-sm text-ink">Apply exactly {selectedEditList.length} selected edit{selectedEditList.length === 1 ? "" : "s"} to <span className="font-mono">{review.targetPath}</span>? The app will reject the whole selection if a text match or anchor has changed.</p><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-3 text-xs text-ink">{combinedPreview}</pre><div className="mt-3 flex gap-2"><button type="button" className="btn btn-primary px-3 py-1.5 text-sm" onClick={apply}>Confirm write</button><button type="button" className="btn btn-secondary px-3 py-1.5 text-sm" onClick={() => setConfirming(false)}>Back</button></div></div>}
              {review.status === "applied" && (
                <div className="space-y-3">
                  <p className="rounded border border-good/40 bg-good/10 p-3 text-sm text-good">Applied and verified at {review.targetPath}.</p>
                  <button type="button" className="btn btn-secondary px-4 py-2 text-sm" onClick={returnToSessions}>
                    Ok
                  </button>
                </div>
              )}
              {(review.status === "cancelled" || review.status === "failed" || review.status === "conflict" || review.status === "incomplete") && (
                <button type="button" className="btn btn-secondary px-3 py-1.5 text-sm" onClick={returnToSessions}>
                  Back to sessions
                </button>
              )}
              {review.error && <p className="text-sm text-critical">{review.error}</p>}
            </>
          )}
        </div>
        {!review && <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-panel p-4 sm:px-5">
          <span className="text-xs text-muted" aria-live="polite">{requestedSessionMissing ? "Requested session unavailable" : selected.size === 0 ? "No sessions selected" : `${selected.size} session${selected.size === 1 ? "" : "s"} selected`}</span>
          <button type="button" className="btn btn-primary px-4 py-2 text-sm" disabled={selected.size === 0 || requestedSessionMissing || info?.hasProviderCredentials === false} onClick={begin}>Start review</button>
        </div>}
      </div>
    </div>
  );
}

function EvidencePreview({ entries, incomplete, hasMore, onLoadMore, onClose }: { entries: GuidanceHistoryEntry[]; incomplete?: string; hasMore: boolean; onLoadMore?: () => void; onClose: () => void }) {
  return <div className="rounded border border-border bg-surface/50 p-3"><div className="flex justify-between"><strong className="text-sm">Evidence preview</strong><button type="button" className="text-xs text-muted" onClick={onClose}>Hide</button></div><div className="mt-2 max-h-48 overflow-y-auto space-y-1 text-xs">{entries.map((entry) => <div key={entry.id} className="rounded bg-panel p-2"><span className="font-semibold">{entryLabel(entry)}</span>{entry.text && <pre className="mt-1 whitespace-pre-wrap text-muted">{entry.text}</pre>}{entry.tool?.input && <pre className="mt-1 whitespace-pre-wrap text-muted">{entry.tool.input}</pre>}{entry.unavailable && <p className="mt-1 text-warn">{entry.unavailable}</p>}</div>)}</div>{incomplete && <p className="mt-2 text-xs text-warn">{incomplete}</p>}{hasMore && onLoadMore && <button type="button" className="btn btn-secondary mt-2 px-2 py-1 text-xs" onClick={onLoadMore}>Load more</button>}</div>;
}

function renderCombinedPreview(review: GuidanceReview, editIds: string[]): string {
  let after = review.initialGuidance;
  for (const edit of review.edits.filter((candidate) => editIds.includes(candidate.id))) {
    if (edit.operation === "replace" && edit.oldText && edit.newText) after = after.replace(edit.oldText, edit.newText);
    else if (edit.operation === "delete" && edit.oldText) after = after.replace(edit.oldText, "");
    else if (edit.operation === "insert" && edit.newText) after = edit.anchor === "__repo_inventory_file_start__" ? `${edit.newText}${after}` : after.replace(edit.anchor!, `${edit.anchor}${edit.newText}`);
  }
  return `--- ${review.targetPath} (review snapshot)\n+++ ${review.targetPath} (selected changes)\n\n${after}`;
}
