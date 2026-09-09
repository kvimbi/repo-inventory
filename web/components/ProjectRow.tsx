import React from "react";
import type { Project, FlagSeverity } from "../../core/types.ts";
import { formatBytes, formatAge, formatSync } from "../lib/format.ts";

interface ProjectRowProps {
  project: Project;
  selected: boolean;
  checked: boolean;
  isExpanded?: boolean;
  isSubRow?: boolean;
  onSelect: (id: string) => void;
  onToggleChecked: (id: string, e?: React.MouseEvent) => void;
  onToggleFavourite: (project: Project, e: React.MouseEvent) => void;
  onToggleTodo?: (project: Project, e: React.MouseEvent) => void;
  onToggleExpand?: (id: string, e: React.MouseEvent) => void;
}

export const ProjectRow = React.memo(function ProjectRow({
  project,
  selected,
  checked,
  isExpanded,
  isSubRow,
  onSelect,
  onToggleChecked,
  onToggleFavourite,
  onToggleTodo,
  onToggleExpand,
}: ProjectRowProps) {
  const highestSeverity = riskToSeverity(project.risk);
  const flagLabels = project.flags.map((f) => f.label).join(", ");
  const isTodo = Boolean(project.annotation.todo);

  // Stack + frameworks chips (up to 3 + 2)
  const stackItems = [...(project.stack ?? []), ...(project.frameworks ?? [])].slice(0, 5);
  const hasMore =
    ((project.stack?.length ?? 0) + (project.frameworks?.length ?? 0)) > 5;

  // Commits 90d
  const commits90d = (project as { commits90d?: number }).commits90d;

  // Last commit with * indicator
  const lastCommit = formatAge(project.lastCommitAgeDays ?? null);
  const lastTouched = project.lastTouchedAgeDays ?? 0;
  const lastCommitAge = project.lastCommitAgeDays ?? 0;
  const showStar = lastTouched > 0 && lastTouched >= lastCommitAge + 30;

  // Size with disposable
  const size = formatBytes(project.sourceBytes);
  const hasDisposable = (project.disposableBytes ?? 0) > 100 * 1024 * 1024;

  // Status
  const status = project.annotation.status === "unknown" ? "—" : project.annotation.status;
  const isSnoozed = project.annotation.snoozedUntil &&
    new Date(project.annotation.snoozedUntil).getTime() > Date.now();

  // Flags
  const nonHealthyFlags = project.flags.filter((f) => f.rule !== "HEALTHY");
  const flagChips = nonHealthyFlags.slice(0, 3);
  const hasMoreFlags = nonHealthyFlags.length > 3;

  // Sync styling
  const sync = formatSync(project);
  const syncColor =
    sync === "local-only"
      ? "text-critical"
      : sync.startsWith("↑") || sync.startsWith("↓")
      ? "text-warn"
      : "text-muted";

  const handleRowClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      onToggleChecked(project.id, e);
    } else {
      onSelect(project.id);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleChecked(project.id, e);
  };

  const handleFavouriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavourite(project, e);
  };

  const handleTodoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleTodo?.(project, e);
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand?.(project.id, e);
  };

  const getRiskDotClass = (severity: FlagSeverity) => {
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
  };

  const getSyncBadge = (syncStr: string) => {
    if (syncStr === "local-only") {
      return "bg-critical/15 text-critical border border-critical/30 font-semibold";
    }
    if (syncStr.includes("↑") || syncStr.includes("↓")) {
      return "bg-warn/15 text-warn border border-warn/30 font-medium";
    }
    return "text-muted";
  };

  const isMonorepoRoot = project.projectType === "monorepo-root" || (project.subProjectCount ?? 0) > 0;

  const rowBgClass = isTodo
    ? selected || checked
      ? "bg-warn/20 border-l-4 border-l-warn shadow-[inset_0_0_8px_rgba(210,153,34,0.3)] font-medium"
      : "bg-warn/15 border-l-4 border-l-warn/90 hover:bg-warn/25 font-medium"
    : selected || checked
    ? "bg-info/10 border-l-2 border-l-info"
    : isSubRow
    ? "bg-surface/30 hover:bg-panel-hover"
    : "hover:bg-panel-hover";

  return (
    <tr
      onClick={handleRowClick}
      className={`group cursor-pointer border-b border-border/50 transition-all ${rowBgClass} ${
        project.suppressed ? "opacity-60" : ""
      }`}
    >
      {/* Checkbox */}
      <td className="px-3 py-2.5 text-center" onClick={handleCheckboxClick}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => {}}
          className="cursor-pointer rounded border-border"
        />
      </td>

      {/* Favourite star */}
      <td className="px-1.5 py-2.5 text-center" onClick={handleFavouriteClick}>
        <button
          type="button"
          title={project.annotation.favourite ? "Remove from favourites" : "Add to favourites"}
          className={`text-xs leading-none transition-all active:scale-90 ${
            project.annotation.favourite
              ? "text-warn font-bold"
              : "text-muted/30 group-hover:text-muted/70 hover:!text-warn"
          }`}
        >
          {project.annotation.favourite ? "★" : "☆"}
        </button>
      </td>

      {/* Todo checkbox */}
      <td className="px-1.5 py-2.5 text-center" onClick={handleTodoClick}>
        <button
          type="button"
          title={isTodo ? "Mark as done" : "Mark as Todo (Needs Action)"}
          className={`text-xs font-mono leading-none transition-all active:scale-90 ${
            isTodo
              ? "text-warn font-bold"
              : "text-muted/30 group-hover:text-muted/70 hover:!text-warn"
          }`}
        >
          {isTodo ? "☑" : "☐"}
        </button>
      </td>

      {/* Risk dot */}
      <td className="px-3 py-2.5 text-center">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${getRiskDotClass(highestSeverity)}`}
          title={flagLabels || "healthy project"}
        />
      </td>

      {/* Project Name & Path */}
      <td className={`px-3 py-2.5 ${isSubRow || project.isSubProject ? "pl-8" : ""}`}>
        <div className="flex items-center gap-1.5 font-semibold text-ink group-hover:text-info transition-colors">
          {isMonorepoRoot && (
            <button
              type="button"
              onClick={handleExpandClick}
              className="inline-flex items-center justify-center h-4 w-4 rounded bg-surface hover:bg-surface-hover text-muted hover:text-info font-mono text-[10px] border border-border/70 transition-colors"
              title={isExpanded ? "Collapse sub-projects" : "Expand sub-projects"}
            >
              {isExpanded ? "▼" : "▶"}
            </button>
          )}
          {(isSubRow || project.isSubProject) && (
            <span className="text-info/70 font-mono text-xs select-none">└─</span>
          )}
          {project.annotation.alias ? (
            <span className="inline-flex items-baseline gap-1.5 min-w-0" title={`Folder: ${project.name}`}>
              <span>{project.annotation.alias}</span>
              <span className="text-[11px] font-mono font-normal text-muted/70">({project.name})</span>
            </span>
          ) : (
            <span>{project.name}</span>
          )}
          {isTodo && (
            <span className="rounded bg-warn/20 border border-warn/40 px-1 py-0.2 text-[9px] font-mono font-semibold text-warn">
              TODO
            </span>
          )}
          {isMonorepoRoot && (
            <button
              type="button"
              onClick={handleExpandClick}
              className="rounded bg-info/10 hover:bg-info/20 border border-info/30 px-1.5 py-0.2 text-[9px] font-mono font-medium text-info transition-colors"
            >
              {project.frameworks?.includes("nx") ? "nx root" : "monorepo root"} ({project.subProjectCount ?? 0})
            </button>
          )}
          {(isSubRow || project.isSubProject) && (
            <span className="rounded bg-surface border border-border/80 px-1 py-0.2 text-[9px] font-mono text-muted">
              sub-app
            </span>
          )}
          {project.skills && project.skills.length > 0 && (
            <span
              className="rounded bg-accent/15 border border-accent/30 px-1 py-0.2 text-[9px] font-mono font-medium text-accent"
              title={`${project.skills.length} agent skill(s): ${project.skills.map((s) => s.name).join(", ")}`}
            >
              ⚡ {project.skills.length === 1 ? "1 skill" : `${project.skills.length} skills`}
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted/80 font-mono truncate max-w-[260px]" title={project.path}>
          {project.relPath}
        </div>
      </td>

      {/* Group */}
      <td className="px-3 py-2.5">
        <span className="inline-block rounded-md bg-surface border border-border/80 px-2 py-0.5 text-[10px] font-medium text-muted">
          {project.group}
        </span>
      </td>

      {/* Kind */}
      <td className={`px-3 py-2.5 text-[11px] ${project.kind !== "repo" ? "text-muted/70 italic" : "text-ink/80"}`}>
        {project.projectType === "sub-project" ? "sub-project" : project.kind}
      </td>

      {/* Stack */}
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {stackItems.map((s) => (
            <span key={s} className="rounded bg-surface border border-border/60 px-1.5 py-0.5 text-[10px] font-mono text-muted">
              {s}
            </span>
          ))}
          {hasMore && <span className="text-[10px] text-muted/60 font-mono">+more</span>}
        </div>
      </td>

      {/* Branch */}
      <td className={`px-3 py-2.5 text-[11px] font-mono ${project.detached ? "text-warn font-semibold" : "text-ink/80"}`}>
        {project.branch ?? "detached"}
      </td>

      {/* Sync */}
      <td className="px-3 py-2.5">
        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono ${getSyncBadge(sync)}`}>
          {sync}
        </span>
      </td>

      {/* Commits 90d */}
      <td className="px-3 py-2.5 text-right font-mono text-[11px]">{commits90d ?? "—"}</td>

      {/* Last commit */}
      <td className="px-3 py-2.5 text-right font-mono text-[11px]">
        {lastCommit}
        {showStar && (
          <span className="text-warn font-bold ml-0.5" title="Files modified more recently than the last commit">*</span>
        )}
      </td>

      {/* Size */}
      <td className="px-3 py-2.5 text-right font-mono text-[11px]">
        <span>{size}</span>
        {hasDisposable && (
          <span className="text-muted/70 text-[10px] block">+{formatBytes(project.disposableBytes)}</span>
        )}
      </td>

      {/* Status */}
      <td className="px-3 py-2.5">
        {status === "—" ? (
          <span className="text-muted/50">—</span>
        ) : (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            status === "active"
              ? "bg-good/15 text-good border border-good/30"
              : status === "obsolete" || status === "archived"
              ? "bg-muted/15 text-muted border border-muted/30"
              : "bg-surface text-muted"
          }`}>
            {status}
            {isSnoozed && <span className="text-warn font-semibold">(snoozed)</span>}
          </span>
        )}
      </td>

      {/* Flags */}
      <td className="px-3 py-2.5">
        {nonHealthyFlags.length === 0 ? (
          <span className="inline-block rounded bg-good/10 text-good border border-good/20 px-1.5 py-0.5 text-[10px] font-medium">
            ok
          </span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {flagChips.map((f) => (
              <span
                key={f.rule}
                className={`rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                  f.severity === "critical"
                    ? "bg-critical/15 text-critical border-critical/30"
                    : f.severity === "warn"
                    ? "bg-warn/15 text-warn border-warn/30"
                    : "bg-info/15 text-info border-info/30"
                }`}
              >
                {f.rule}
              </span>
            ))}
            {hasMoreFlags && (
              <span className="text-[10px] text-muted/70 font-mono font-medium self-center">
                +{nonHealthyFlags.length - 3}
              </span>
            )}
          </div>
        )}
      </td>
    </tr>
  );
});

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

