import { useState } from "react";
import type { Project, FlagSeverity, ProjectStatus } from "../../core/types.ts";
import { IDE_LAUNCHERS } from "../../core/ides.ts";
import {
  saveBatchAnnotations,
  openInIde,
  rescanSingleProject,
  executeAction,
  fetchProject,
  saveAnnotation,
  type AnnotationPatch,
} from "../apiClient.ts";
import { formatBytes } from "../lib/format.ts";

const STATUSES: readonly ProjectStatus[] = ["unknown", "active", "stale", "obsolete", "archived"] as const;

interface MultiDetailPanelProps {
  projects: Project[];
  actions?: Array<{ name: string; label: string; description: string }>;
  onClose: () => void;
  onSavedBatch: (updatedProjects: Project[]) => void;
  onUncheckProject: (id: string) => void;
  onRescanProject?: (id: string, fetchRemotes?: boolean) => Promise<void>;
  onGenerateScript?: (actionName: string, projectIds?: string[]) => void;
}

export function MultiDetailPanel({
  projects,
  actions = [],
  onClose,
  onSavedBatch,
  onUncheckProject,
  onRescanProject,
  onGenerateScript,
}: MultiDetailPanelProps) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Batch note state
  const [batchNote, setBatchNote] = useState("");

  // IDE launch state
  const [openingIde, setOpeningIde] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openStatus, setOpenStatus] = useState<string | null>(null);

  // Batch refresh state
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Batch action executing state
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOutput, setActionOutput] = useState<string | null>(null);

  const ids = projects.map((p) => p.id);

  // Risk summary counts
  const criticalCount = projects.filter((p) => p.risk === 3).length;
  const warnCount = projects.filter((p) => p.risk === 2).length;
  const infoCount = projects.filter((p) => p.risk === 1).length;
  const goodCount = projects.filter((p) => p.risk === 0).length;

  // Status breakdown
  const statusCounts = new Map<string, number>();
  for (const p of projects) {
    const s = p.annotation.status;
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
  }
  const allSameStatus = statusCounts.size === 1 ? projects[0].annotation.status : null;

  // Favourites and Todos counts
  const favouriteCount = projects.filter((p) => Boolean(p.annotation.favourite)).length;
  const todoCount = projects.filter((p) => Boolean(p.annotation.todo)).length;
  const snoozedCount = projects.filter((p) =>
    Boolean(p.annotation.snoozedUntil && new Date(p.annotation.snoozedUntil).getTime() > Date.now()),
  ).length;

  // Total size
  const totalBytes = projects.reduce((acc, p) => acc + (p.sourceBytes ?? 0), 0);
  const totalDisposableBytes = projects.reduce((acc, p) => acc + (p.disposableBytes ?? 0), 0);

  // Aggregated flags map (rule -> array of projects)
  const flagsMap = new Map<string, { label: string; severity: FlagSeverity; projects: Project[] }>();
  for (const p of projects) {
    for (const flag of p.flags) {
      if (flag.rule === "HEALTHY") continue;
      const existing = flagsMap.get(flag.rule);
      if (existing) {
        existing.projects.push(p);
      } else {
        flagsMap.set(flag.rule, {
          label: flag.label,
          severity: flag.severity,
          projects: [p],
        });
      }
    }
  }

  // --- Handlers ---

  async function copyAllPaths() {
    try {
      const text = projects.map((p) => p.path).join("\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function applyBatchPatch(patch: AnnotationPatch) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await saveBatchAnnotations(ids, patch);
      if (res.projects && res.projects.length > 0) {
        onSavedBatch(res.projects);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: typeof STATUSES[number]) {
    await applyBatchPatch({ status });
  }

  async function handleSetFavourites(fav: boolean) {
    await applyBatchPatch({ favourite: fav });
  }

  async function handleSetTodos(todoVal: boolean) {
    await applyBatchPatch({ todo: todoVal });
  }

  async function handleQuickSnooze(days: number) {
    const iso = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await applyBatchPatch({ snoozedUntil: iso });
  }

  async function handleClearSnooze() {
    await applyBatchPatch({ snoozedUntil: null });
  }

  async function handleReplaceNotes() {
    if (batchNote.trim() === "") return;
    await applyBatchPatch({ note: batchNote.trim() });
    setBatchNote("");
  }

  async function handleAppendNotes() {
    if (batchNote.trim() === "") return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated: Project[] = [];
      for (const p of projects) {
        const existing = p.annotation.note ? p.annotation.note.trim() : "";
        const nextNote = existing ? `${existing}\n${batchNote.trim()}` : batchNote.trim();
        const res = await saveAnnotation(p.id, { note: nextNote });
        if (res.project) updated.push(res.project);
      }
      if (updated.length > 0) {
        onSavedBatch(updated);
      }
      setBatchNote("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenInIde(ideId: string) {
    setOpenError(null);
    setOpeningIde(ideId);
    setOpenStatus(`Opening ${projects.length} directories…`);
    const errors: string[] = [];
    try {
      for (let i = 0; i < projects.length; i++) {
        const p = projects[i];
        setOpenStatus(`Opening (${i + 1}/${projects.length}) ${p.name}…`);
        try {
          await openInIde(p.id, ideId);
        } catch (err) {
          errors.push(`${p.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (errors.length > 0) {
        setOpenError(errors.join("\n"));
      } else {
        setOpenStatus(null);
      }
    } finally {
      setOpeningIde(null);
    }
  }

  async function handleBatchRefresh(fetchRemotes: boolean) {
    setRefreshError(null);
    setRefreshing(true);
    const updated: Project[] = [];
    const errors: string[] = [];

    try {
      for (let i = 0; i < projects.length; i++) {
        const p = projects[i];
        setRefreshProgress(`Refreshing (${i + 1}/${projects.length}) ${p.name}…`);
        try {
          if (onRescanProject) {
            await onRescanProject(p.id, fetchRemotes);
          } else {
            const res = await rescanSingleProject(p.id, fetchRemotes);
            if (res.project) updated.push(res.project);
          }
        } catch (err) {
          errors.push(`${p.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (updated.length > 0) {
        onSavedBatch(updated);
      }
      if (errors.length > 0) {
        setRefreshError(errors.join("\n"));
      }
    } finally {
      setRefreshing(false);
      setRefreshProgress(null);
    }
  }

  async function handleBatchQuickFetch(targetProjects: Project[]) {
    setExecutingAction("fetch");
    setActionError(null);
    setActionOutput(null);
    const updated: Project[] = [];
    const logs: string[] = [];

    try {
      for (let i = 0; i < targetProjects.length; i++) {
        const p = targetProjects[i];
        try {
          const res = await fetchProject(p.id);
          if (res.project) updated.push(res.project);
          logs.push(`✓ Fetched ${p.name}`);
        } catch (err) {
          logs.push(`✗ ${p.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (updated.length > 0) {
        onSavedBatch(updated);
      }
      setActionOutput(logs.join("\n"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecutingAction(null);
    }
  }

  async function handleBatchExecuteAction(actionName: string, targetProjects: Project[]) {
    setExecutingAction(actionName);
    setActionError(null);
    setActionOutput(null);
    const updated: Project[] = [];
    const logs: string[] = [];

    try {
      for (let i = 0; i < targetProjects.length; i++) {
        const p = targetProjects[i];
        try {
          const res = await executeAction(p.id, actionName);
          if (res.project) updated.push(res.project);
          logs.push(`✓ ${actionName} succeeded on ${p.name}`);
        } catch (err) {
          logs.push(`✗ ${p.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (updated.length > 0) {
        onSavedBatch(updated);
      }
      setActionOutput(logs.join("\n"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecutingAction(null);
    }
  }

  async function handleBulkSuppressFlag(ruleName: string, targetProjects: Project[]) {
    setSaving(true);
    setSaveError(null);
    try {
      const updated: Project[] = [];
      for (const p of targetProjects) {
        const current = p.annotation.suppressedFlags ?? [];
        if (!current.includes(ruleName)) {
          const next = [...current, ruleName];
          const res = await saveAnnotation(p.id, { suppressedFlags: next });
          if (res.project) updated.push(res.project);
        }
      }
      if (updated.length > 0) {
        onSavedBatch(updated);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="flex w-[460px] shrink-0 flex-col overflow-hidden border-l border-border bg-panel shadow-2xl">
      {/* Hero Header */}
      <div className="flex items-center justify-between border-b border-border bg-panel/95 backdrop-blur-xs p-4 sticky top-0 z-20">
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center rounded-full bg-info/20 px-2.5 py-0.5 text-xs font-bold text-info border border-info/30">
              {projects.length} Selected
            </span>
            <h2 className="truncate text-base font-bold tracking-tight text-ink">Bulk Operations</h2>
          </div>
          <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted">
            <span>{formatBytes(totalBytes)}</span>
            {totalDisposableBytes > 0 && (
              <span className="text-muted/70">({formatBytes(totalDisposableBytes)} disposable)</span>
            )}
            <span>·</span>
            <div className="flex items-center gap-1.5 font-mono">
              {criticalCount > 0 && <span className="text-critical font-semibold">{criticalCount} critical</span>}
              {warnCount > 0 && <span className="text-warn font-semibold">{warnCount} warn</span>}
              {infoCount > 0 && <span className="text-info">{infoCount} info</span>}
              {goodCount > 0 && <span className="text-good">{goodCount} healthy</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={copyAllPaths}
            className="btn btn-secondary px-2.5 py-1 text-xs"
            title="Copy newline-separated paths to clipboard"
          >
            {copied ? "Copied" : "Copy paths"}
          </button>
          <button
            onClick={onClose}
            className="btn btn-ghost px-2 py-1 text-base text-muted hover:text-ink"
            title="Clear selection and close panel (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status & Annotation Card */}
        <div className="rounded-xl border border-border/80 bg-surface/50 p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted">Project Status (Bulk Change)</h3>
            {saving && <span className="text-[10px] text-info animate-pulse font-medium">saving…</span>}
          </div>

          <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
            {STATUSES.map((s) => {
              const isSelected = allSameStatus === s;
              const count = statusCounts.get(s) ?? 0;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleStatusChange(s)}
                  disabled={saving}
                  className={`flex-1 rounded-md px-1.5 py-1.5 text-xs font-medium transition-all text-center ${
                    isSelected
                      ? "bg-info text-white shadow-xs font-bold"
                      : "text-muted hover:text-ink hover:bg-panel-hover"
                  }`}
                  title={`Set status to ${s} for all ${projects.length} selected projects`}
                >
                  <div>{s}</div>
                  {count > 0 && !isSelected && (
                    <div className="text-[9px] text-muted/70 font-mono">({count})</div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Status distribution breakdown if mixed */}
          {allSameStatus === null && (
            <div className="text-[10px] text-muted font-mono flex flex-wrap gap-1.5">
              <span>Current:</span>
              {Array.from(statusCounts.entries()).map(([st, cnt]) => (
                <span key={st} className="rounded bg-surface px-1.5 py-0.5 border border-border/60">
                  {st}: {cnt}
                </span>
              ))}
            </div>
          )}

          {/* Favourites & Todo Toggles */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
            <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/40 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ink">Favourites</span>
                <span className="text-[10px] text-muted font-mono">{favouriteCount}/{projects.length}</span>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSetFavourites(true)}
                  disabled={saving}
                  className="btn btn-secondary flex-1 py-1 text-xs hover:text-warn flex items-center justify-center gap-1"
                >
                  <span>★</span>
                  <span>Pin all</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSetFavourites(false)}
                  disabled={saving}
                  className="btn btn-ghost flex-1 py-1 text-xs text-muted hover:text-ink"
                >
                  Unpin all
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/40 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ink">Needs Action (Todo)</span>
                <span className="text-[10px] text-muted font-mono">{todoCount}/{projects.length}</span>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSetTodos(true)}
                  disabled={saving}
                  className="btn btn-secondary flex-1 py-1 text-xs hover:text-warn flex items-center justify-center gap-1"
                >
                  <span>☑</span>
                  <span>Mark Todo</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSetTodos(false)}
                  disabled={saving}
                  className="btn btn-ghost flex-1 py-1 text-xs text-muted hover:text-ink"
                >
                  Mark Done
                </button>
              </div>
            </div>
          </div>

          {/* Snooze Flag Alerts */}
          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Snooze Flag Alerts
              </label>
              {snoozedCount > 0 && (
                <span className="text-[10px] text-warn font-mono">{snoozedCount} currently snoozed</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => handleQuickSnooze(7)}
                disabled={saving}
                className="btn btn-secondary px-2.5 py-1 text-xs"
              >
                Snooze +1w
              </button>
              <button
                type="button"
                onClick={() => handleQuickSnooze(30)}
                disabled={saving}
                className="btn btn-secondary px-2.5 py-1 text-xs"
              >
                Snooze +1m
              </button>
              <button
                type="button"
                onClick={() => handleQuickSnooze(90)}
                disabled={saving}
                className="btn btn-secondary px-2.5 py-1 text-xs"
              >
                Snooze +3m
              </button>
              <button
                type="button"
                onClick={handleClearSnooze}
                disabled={saving}
                className="btn btn-ghost px-2.5 py-1 text-xs text-warn hover:bg-warn/10"
              >
                Clear Snooze
              </button>
            </div>
          </div>

          {/* Batch Note Editor */}
          <div className="pt-2 border-t border-border/50">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">
              Batch Note / Comment
            </label>
            <textarea
              value={batchNote}
              onChange={(e) => setBatchNote(e.target.value)}
              disabled={saving}
              rows={2}
              maxLength={2000}
              placeholder="Apply note across all selected projects…"
              className="input-control w-full px-2.5 py-1.5 text-xs placeholder:text-muted/50 resize-y mb-1.5"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleReplaceNotes}
                disabled={saving || batchNote.trim() === ""}
                className="btn btn-secondary px-2.5 py-1 text-xs hover:border-info/50"
              >
                Overwrite notes
              </button>
              <button
                type="button"
                onClick={handleAppendNotes}
                disabled={saving || batchNote.trim() === ""}
                className="btn btn-secondary px-2.5 py-1 text-xs hover:border-info/50"
              >
                Append to existing
              </button>
            </div>
          </div>

          {saveError && (
            <div className="rounded bg-critical/10 border border-critical/20 p-2 text-xs text-critical">
              {saveError}
            </div>
          )}
        </div>

        {/* Actions & Launchers Card */}
        <div className="rounded-xl border border-border/80 bg-surface/50 p-4 shadow-2xs space-y-3">
          {/* Open In Editor */}
          <div>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
              Open All In Editor / IDE
            </h3>
            <div className="flex flex-wrap gap-2">
              {IDE_LAUNCHERS.map((ide) => (
                <button
                  key={ide.id}
                  onClick={() => handleOpenInIde(ide.id)}
                  disabled={openingIde !== null}
                  className="btn btn-secondary px-3 py-1.5 text-xs hover:border-info/50 flex items-center gap-1.5"
                >
                  {openingIde === ide.id ? (
                    <>
                      <span className="inline-block animate-spin">🔄</span>
                      <span>Launching…</span>
                    </>
                  ) : (
                    <span>{ide.label}</span>
                  )}
                </button>
              ))}
            </div>
            {openStatus && (
              <div className="mt-2 text-xs text-info bg-info/10 p-2 rounded border border-info/20">
                {openStatus}
              </div>
            )}
            {openError && (
              <div className="mt-2 text-xs text-critical bg-critical/10 p-2 rounded border border-critical/20 whitespace-pre-wrap">
                {openError}
              </div>
            )}
          </div>

          {/* Refresh / Update Status */}
          <div className="pt-2 border-t border-border/50">
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
              Refresh / Update Status (All Selected)
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleBatchRefresh(true)}
                disabled={refreshing}
                className="btn btn-secondary px-3 py-1.5 text-xs hover:border-info/50 flex items-center gap-1.5"
              >
                {refreshing ? (
                  <>
                    <span className="inline-block animate-spin">🔄</span>
                    <span>Refreshing…</span>
                  </>
                ) : (
                  <>
                    <span>🔄</span>
                    <span>Refresh all (with fetch)</span>
                  </>
                )}
              </button>
              <button
                onClick={() => handleBatchRefresh(false)}
                disabled={refreshing}
                className="btn btn-secondary px-3 py-1.5 text-xs hover:border-info/50 flex items-center gap-1.5"
              >
                <span>⚡</span>
                <span>Refresh local only</span>
              </button>
            </div>
            {refreshProgress && (
              <div className="mt-2 text-xs text-info bg-info/10 p-2 rounded border border-info/20 font-mono">
                {refreshProgress}
              </div>
            )}
            {refreshError && (
              <div className="mt-2 text-xs text-critical bg-critical/10 p-2 rounded border border-critical/20 whitespace-pre-wrap">
                {refreshError}
              </div>
            )}
          </div>

          {/* Scripts Generator for Selection */}
          {actions.length > 0 && onGenerateScript && (
            <div className="pt-2 border-t border-border/50">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                Generate Maintenance Scripts
              </h3>
              <div className="flex flex-wrap gap-2">
                {actions.map((act) => (
                  <button
                    key={act.name}
                    onClick={() => onGenerateScript(act.name, ids)}
                    className="btn btn-secondary px-3 py-1.5 text-xs hover:border-info/50"
                    title={act.description}
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Aggregated Flags & Actions Card */}
        {flagsMap.size > 0 && (
          <div className="rounded-xl border border-border/80 bg-surface/50 p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted">
                Aggregated Flags & Bulk Actions
              </h3>
              <span className="rounded-full bg-surface border border-border/80 px-2 py-0.5 text-[10px] font-mono text-muted">
                {flagsMap.size} flag rules
              </span>
            </div>

            <div className="space-y-2">
              {Array.from(flagsMap.entries()).map(([rule, info]) => {
                const canSuppress = rule !== "RULE_ERROR" && rule !== "PROBE_ERROR";
                return (
                  <div
                    key={rule}
                    className={`rounded-lg border-l-3 bg-surface p-2.5 text-xs ${
                      info.severity === "critical"
                        ? "border-l-critical bg-critical/5 border-border/50"
                        : info.severity === "warn"
                        ? "border-l-warn bg-warn/5 border-border/50"
                        : "border-l-info bg-info/5 border-border/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-ink">{info.label}</span>
                        <span className="ml-1.5 text-[11px] font-mono text-muted/80">
                          ({info.projects.length} {info.projects.length === 1 ? "project" : "projects"})
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {rule === "STALE_REFS" && (
                          <button
                            type="button"
                            onClick={() => handleBatchQuickFetch(info.projects)}
                            disabled={executingAction !== null}
                            className="btn btn-secondary px-2.5 py-1 text-xs hover:border-info/50 flex items-center gap-1"
                          >
                            <span>⚡</span>
                            <span>Quick fetch ({info.projects.length})</span>
                          </button>
                        )}
                        {rule === "NOT_VERSIONED" && (
                          <button
                            type="button"
                            onClick={() => handleBatchExecuteAction("init", info.projects)}
                            disabled={executingAction !== null}
                            className="btn btn-secondary px-2.5 py-1 text-xs hover:border-info/50 flex items-center gap-1"
                          >
                            <span>🌱</span>
                            <span>Git init ({info.projects.length})</span>
                          </button>
                        )}
                        {rule === "LOCAL_ONLY" && (
                          <button
                            type="button"
                            onClick={() => handleBatchExecuteAction("publish", info.projects)}
                            disabled={executingAction !== null}
                            className="btn btn-secondary px-2.5 py-1 text-xs hover:border-info/50 flex items-center gap-1"
                          >
                            <span>🚀</span>
                            <span>Publish ({info.projects.length})</span>
                          </button>
                        )}
                        {rule === "NO_UPSTREAM" && (
                          <button
                            type="button"
                            onClick={() => handleBatchExecuteAction("set-upstream", info.projects)}
                            disabled={executingAction !== null}
                            className="btn btn-secondary px-2.5 py-1 text-xs hover:border-info/50 flex items-center gap-1"
                          >
                            <span>⬆️</span>
                            <span>Set upstream ({info.projects.length})</span>
                          </button>
                        )}
                        {canSuppress && (
                          <button
                            type="button"
                            onClick={() => handleBulkSuppressFlag(rule, info.projects)}
                            disabled={saving}
                            className="btn btn-ghost px-2 py-0.5 text-[10px] text-muted hover:text-warn hover:bg-warn/10"
                            title={`Bulk suppress ${rule} for these ${info.projects.length} projects`}
                          >
                            🔇 Suppress all
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-muted/60">{rule}</div>
                  </div>
                );
              })}
            </div>

            {actionOutput && (
              <div className="rounded border border-border/80 bg-surface p-2 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-auto">
                <div className="text-[10px] font-bold text-muted uppercase mb-1">Execution Output</div>
                {actionOutput}
              </div>
            )}
            {actionError && (
              <div className="rounded bg-critical/10 border border-critical/20 p-2 text-xs text-critical whitespace-pre-wrap">
                {actionError}
              </div>
            )}
          </div>
        )}

        {/* Selected Projects List */}
        <div className="rounded-xl border border-border/80 bg-surface/50 p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted">
              Selected Projects ({projects.length})
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-[10px] text-muted hover:text-ink font-medium"
            >
              Clear all
            </button>
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {projects.map((p) => {
              const pSeverity = p.risk === 3 ? "critical" : p.risk === 2 ? "warn" : p.risk === 1 ? "info" : "good";
              const pStatus = p.annotation.status;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-surface p-2 hover:bg-surface-hover transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                          pSeverity === "critical"
                            ? "bg-critical"
                            : pSeverity === "warn"
                            ? "bg-warn"
                            : pSeverity === "info"
                            ? "bg-info"
                            : "bg-good"
                        }`}
                      />
                      <span className="truncate text-xs font-semibold text-ink">
                        {p.annotation.alias || p.name}
                      </span>
                      {p.annotation.favourite && <span className="text-warn text-[11px]">★</span>}
                      {p.annotation.todo && (
                        <span className="rounded bg-warn/20 px-1 text-[8px] font-mono font-semibold text-warn">
                          TODO
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[10px] font-mono text-muted/70">{p.relPath}</div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="rounded-full bg-surface border border-border/80 px-2 py-0.5 text-[9px] font-medium text-muted">
                      {pStatus}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUncheckProject(p.id)}
                      className="text-muted hover:text-critical font-bold text-xs p-1 leading-none rounded hover:bg-surface"
                      title={`Remove ${p.name} from selection`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
