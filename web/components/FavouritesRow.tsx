import React from "react";
import type { Project, FlagSeverity } from "../../core/types.ts";
import { formatAge, formatSync } from "../lib/format.ts";

interface FavouritesRowProps {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleFavourite: (project: Project, e: React.MouseEvent) => void;
}

export function FavouritesRow({
  projects,
  selectedId,
  onSelect,
  onToggleFavourite,
}: FavouritesRowProps) {
  const favourites = projects.filter((p) => p.annotation.favourite);

  if (favourites.length === 0) {
    return null;
  }

  return (
    <section aria-label="Favourites" className="border-b border-border bg-panel/40 px-5 py-3 transition-all">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-warn text-sm">★</span>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">Favourites</h2>
          <span className="rounded-full bg-warn/15 border border-warn/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-warn">
            {favourites.length}
          </span>
        </div>
        <span className="text-[11px] text-muted">Quick access pinned projects</span>
      </div>

      <div className="flex items-center gap-3 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
        {favourites.map((p) => {
          const isSelected = selectedId === p.id;
          const highestSeverity = riskToSeverity(p.risk);
          const sync = formatSync(p);
          const stackItems = [...(p.stack ?? []), ...(p.frameworks ?? [])].slice(0, 3);
          const lastCommit = formatAge(p.lastCommitAgeDays ?? null);

          return (
            <div
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`group relative flex flex-col justify-between min-w-[240px] max-w-[280px] flex-shrink-0 cursor-pointer rounded-lg border p-3 transition-all shadow-xs ${
                isSelected
                  ? "bg-panel border-info shadow-md ring-1 ring-info/40"
                  : "bg-panel border-border/80 hover:border-border hover:bg-panel-hover hover:shadow-sm"
              }`}
            >
              {/* Card Header: Risk dot + Name + Star */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${getRiskDotClass(highestSeverity)}`}
                    title={`Risk level: ${highestSeverity}`}
                  />
                  <span className="font-semibold text-xs text-ink truncate group-hover:text-info transition-colors" title={p.annotation?.alias ? `${p.annotation.alias} (${p.name})` : p.name}>
                    {p.annotation?.alias || p.name}
                  </span>
                </div>

                <button
                  type="button"
                  title="Remove from favourites"
                  onClick={(e) => onToggleFavourite(p, e)}
                  className="text-warn hover:text-warn/70 text-sm transition-transform active:scale-95 p-0.5 -mt-1 -mr-1"
                >
                  ★
                </button>
              </div>

              {/* Group & Sync Badges */}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap text-[10px]">
                <span className="rounded bg-surface border border-border/80 px-1.5 py-0.5 font-medium text-muted truncate max-w-[100px]">
                  {p.group}
                </span>

                {sync !== "synced" && (
                  <span className={`rounded px-1.5 py-0.5 font-mono ${getSyncBadge(sync)}`}>
                    {sync}
                  </span>
                )}
              </div>

              {/* Stack Chips */}
              {stackItems.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {stackItems.map((s) => (
                    <span key={s} className="rounded bg-surface/80 border border-border/60 px-1 py-0.2 text-[9px] font-mono text-muted/90">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {/* Card Footer: Path & Last Commit */}
              <div className="flex items-center justify-between text-[10px] text-muted/70 font-mono mt-2.5 pt-2 border-t border-border/40">
                <span className="truncate max-w-[140px]" title={p.relPath}>
                  {p.relPath}
                </span>
                <span title="Last commit age">{lastCommit}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function riskToSeverity(risk: number): FlagSeverity {
  switch (risk) {
    case 3:
      return "critical";
    case 2:
      return "warn";
    case 1:
      return "info";
    default:
      return "good";
  }
}

function getRiskDotClass(severity: FlagSeverity) {
  switch (severity) {
    case "critical":
      return "bg-critical shadow-[0_0_6px_rgba(248,81,73,0.7)]";
    case "warn":
      return "bg-warn shadow-[0_0_6px_rgba(210,153,34,0.7)]";
    case "info":
      return "bg-info shadow-[0_0_6px_rgba(88,166,255,0.7)]";
    default:
      return "bg-good shadow-[0_0_6px_rgba(63,185,80,0.7)]";
  }
}

function getSyncBadge(syncStr: string) {
  if (syncStr === "local-only") {
    return "bg-critical/15 text-critical border border-critical/30 font-semibold";
  }
  if (syncStr.includes("↑") || syncStr.includes("↓")) {
    return "bg-warn/15 text-warn border border-warn/30 font-medium";
  }
  return "text-muted";
}
