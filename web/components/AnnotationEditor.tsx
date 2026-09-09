import { useState } from "react";
import type { Project } from "../../core/types.ts";
import { saveAnnotation } from "../apiClient.ts";
import { formatTimestamp } from "../lib/format.ts";

interface AnnotationEditorProps {
  project: Project;
  onSaved: (project: Project) => void;
}

const STATUSES = ["unknown", "active", "stale", "obsolete", "archived"] as const;

export function AnnotationEditor({ project, onSaved }: AnnotationEditorProps) {
  const [alias, setAlias] = useState(project.annotation.alias ?? "");
  const [status, setStatus] = useState(project.annotation.status);
  const [note, setNote] = useState(project.annotation.note);
  const [snoozedUntil, setSnoozedUntil] = useState<string | null>(project.annotation.snoozedUntil);
  const [favourite, setFavourite] = useState<boolean>(project.annotation.favourite ?? false);
  const [todo, setTodo] = useState<boolean>(project.annotation.todo ?? false);
  const [suppressedFlags, setSuppressedFlags] = useState<string[]>(project.annotation.suppressedFlags ?? []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save(patch: {
    status?: typeof STATUSES[number];
    note?: string;
    snoozedUntil?: string | null;
    favourite?: boolean;
    todo?: boolean;
    alias?: string | null;
    suppressedFlags?: string[];
  }) {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveAnnotation(project.id, patch);
      if (result.project) {
        onSaved(result.project);
        if (patch.status) setStatus(result.annotation.status);
        if (patch.note !== undefined) setNote(result.annotation.note);
        if (patch.snoozedUntil !== undefined) setSnoozedUntil(result.annotation.snoozedUntil);
        if (patch.favourite !== undefined) setFavourite(Boolean(result.annotation.favourite));
        if (patch.todo !== undefined) setTodo(Boolean(result.annotation.todo));
        if (patch.alias !== undefined) setAlias(result.annotation.alias ?? "");
        if (patch.suppressedFlags !== undefined) setSuppressedFlags(result.annotation.suppressedFlags ?? []);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const handleToggleFavourite = () => {
    const next = !favourite;
    setFavourite(next);
    save({ favourite: next });
  };

  const handleToggleTodo = () => {
    const next = !todo;
    setTodo(next);
    save({ todo: next });
  };

  const handleAliasBlur = () => {
    const trimmed = alias.trim();
    const currentAlias = (project.annotation.alias ?? "").trim();
    if (trimmed !== currentAlias) {
      save({ alias: trimmed || null });
    }
  };

  const handleNoteBlur = () => {
    if (note !== project.annotation.note) {
      save({ note });
    }
  };

  const handleStatusClick = (s: typeof STATUSES[number]) => {
    if (s !== status) {
      save({ status: s });
    }
  };

  const handleSnoozeDate = (date: string) => {
    if (date) {
      const iso = new Date(date).toISOString();
      setSnoozedUntil(iso);
      save({ snoozedUntil: iso });
    }
  };

  const handleQuickSnooze = (days: number) => {
    const iso = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    setSnoozedUntil(iso);
    save({ snoozedUntil: iso });
  };

  const handleClearSnooze = () => {
    setSnoozedUntil(null);
    save({ snoozedUntil: null });
  };

  const snoozeDateStr = snoozedUntil ? new Date(snoozedUntil).toISOString().slice(0, 10) : "";
  const isSnoozed = snoozedUntil && new Date(snoozedUntil).getTime() > Date.now();

  return (
    <div className="space-y-3">
      {/* Alias Input */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Alias / Display Name</label>
          {saving && <span className="text-[10px] text-info animate-pulse">saving…</span>}
        </div>
        <input
          type="text"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          onBlur={handleAliasBlur}
          disabled={saving}
          maxLength={100}
          placeholder={`Display name override (default: ${project.name})`}
          className="input-control w-full px-2.5 py-1.5 text-xs placeholder:text-muted/50"
        />
      </div>

      {/* Favourite & Todo Toggles */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/40 p-2.5">
          <div>
            <span className="text-xs font-semibold text-ink">Pinned Favourite</span>
            <p className="text-[10px] text-muted">Show in top row</p>
          </div>
          <button
            type="button"
            onClick={handleToggleFavourite}
            disabled={saving}
            className={`btn text-xs px-2 py-1 transition-all ${
              favourite
                ? "bg-warn/15 text-warn border border-warn/40 hover:bg-warn/25 font-medium"
                : "btn-secondary hover:text-warn"
            }`}
          >
            <span className="text-sm">{favourite ? "★" : "☆"}</span>
            <span>{favourite ? "Pinned" : "Pin"}</span>
          </button>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/40 p-2.5">
          <div>
            <span className="text-xs font-semibold text-ink">Needs Action</span>
            <p className="text-[10px] text-muted">Highlight project row</p>
          </div>
          <button
            type="button"
            onClick={handleToggleTodo}
            disabled={saving}
            className={`btn text-xs px-2 py-1 transition-all ${
              todo
                ? "bg-warn/20 text-warn border border-warn/50 hover:bg-warn/30 font-semibold"
                : "btn-secondary hover:text-warn"
            }`}
          >
            <span className="text-sm">{todo ? "☑" : "☐"}</span>
            <span>{todo ? "Todo" : "Mark Todo"}</span>
          </button>
        </div>
      </div>

      {/* Segmented Status Selector */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">
          Project Status
        </label>
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
          {STATUSES.map((s) => {
            const isActive = status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => handleStatusClick(s)}
                disabled={saving}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-info text-white shadow-xs font-semibold"
                    : "text-muted hover:text-ink hover:bg-panel-hover"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Note Editor */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Note / Rationale</label>
          {saving && <span className="text-[10px] text-info animate-pulse">saving…</span>}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={handleNoteBlur}
          disabled={saving}
          rows={3}
          maxLength={2000}
          placeholder="Why does this project exist? What is it superseded by?"
          className="input-control w-full px-2.5 py-1.5 text-xs placeholder:text-muted/50 resize-y"
        />
        {note.length > 1800 && (
          <div className="mt-1 text-[10px] text-muted text-right">
            {note.length}/2000
          </div>
        )}
      </div>

      {/* Snooze Section */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">
          Snooze Flag Alerts
        </label>
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            type="date"
            value={snoozeDateStr}
            onChange={(e) => handleSnoozeDate(e.target.value)}
            disabled={saving}
            className="input-control px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={() => handleQuickSnooze(7)}
            disabled={saving}
            className="btn btn-secondary px-2 py-1 text-[11px]"
          >
            +1w
          </button>
          <button
            type="button"
            onClick={() => handleQuickSnooze(30)}
            disabled={saving}
            className="btn btn-secondary px-2 py-1 text-[11px]"
          >
            +1m
          </button>
          <button
            type="button"
            onClick={() => handleQuickSnooze(90)}
            disabled={saving}
            className="btn btn-secondary px-2 py-1 text-[11px]"
          >
            +3m
          </button>
          {isSnoozed && (
            <button
              type="button"
              onClick={handleClearSnooze}
              disabled={saving}
              className="btn btn-ghost px-2 py-1 text-[11px] text-warn hover:bg-warn/10"
            >
              Clear
            </button>
          )}
        </div>
        {isSnoozed && (
          <div className="mt-1.5 rounded bg-warn/10 border border-warn/20 p-2 text-[10px] text-warn">
            Non-critical flags hidden until {formatTimestamp(snoozedUntil)}. (Data-loss rules stay active).
          </div>
        )}
      </div>

      {/* Suppressed Rule Flags Section */}
      {suppressedFlags.length > 0 && (
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">
            Suppressed Rule Flags ({suppressedFlags.length})
          </label>
          <div className="flex flex-wrap gap-1.5">
            {suppressedFlags.map((ruleName) => (
              <span
                key={ruleName}
                className="inline-flex items-center gap-1 rounded bg-surface border border-border/80 px-2 py-0.5 text-xs text-ink font-mono"
              >
                <span>{ruleName}</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = suppressedFlags.filter((r) => r !== ruleName);
                    setSuppressedFlags(next);
                    save({ suppressedFlags: next });
                  }}
                  disabled={saving}
                  className="text-muted hover:text-critical font-bold text-xs ml-0.5"
                  title={`Unsuppress ${ruleName}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {saveError && <div className="rounded bg-critical/10 border border-critical/20 p-2 text-xs text-critical">{saveError}</div>}
      {project.annotation.updatedAt && (
        <div className="text-[10px] text-muted/70 text-right">
          Last annotated {formatTimestamp(project.annotation.updatedAt)}
        </div>
      )}
    </div>
  );
}
