import type { FlagSeverity, Project, ProjectStatus } from "../../core/types.ts";
import { formatBytes } from "../lib/format.ts";

interface SummaryBarProps {
  projects: Project[];
  activeSeverities: FlagSeverity[];
  onToggleSeverity: (severity: FlagSeverity) => void;
  activeStatuses?: ProjectStatus[];
  onToggleStatus?: (status: ProjectStatus) => void;
}

function Card({
  label,
  value,
  color,
  active,
  onClick,
}: {
  label: string;
  value: string | number;
  color?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const isInteractive = Boolean(onClick);
  return (
    <button
      type={isInteractive ? "button" : undefined}
      disabled={!isInteractive}
      onClick={onClick}
      className={`relative flex flex-col justify-between rounded-lg border px-3 py-1.5 text-left transition-all ${
        isInteractive
          ? "cursor-pointer hover:border-info/50 hover:bg-panel-hover hover:shadow-sm"
          : "cursor-default"
      } ${
        active
          ? "border-info bg-panel shadow-sm ring-1 ring-info/30"
          : "border-border bg-panel"
      }`}
      title={isInteractive ? `Toggle ${label} filter` : undefined}
    >
      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <span>{label}</span>
        {isInteractive && (
          <span
            className={`h-1.5 w-1.5 rounded-full transition-colors ${
              active ? "bg-info" : "bg-border"
            }`}
          />
        )}
      </div>
      <div className={`text-lg font-bold tracking-tight mt-0.5 ${color || "text-ink"}`}>
        {value}
      </div>
    </button>
  );
}

export function SummaryBar({
  projects,
  activeSeverities,
  onToggleSeverity,
  activeStatuses = [],
  onToggleStatus,
}: SummaryBarProps) {
  // Status stats
  const activeCount = projects.filter((p) => p.annotation?.status === "active").length;
  const staleCount = projects.filter((p) => p.annotation?.status === "stale").length;
  const unknownCount = projects.filter((p) => !p.annotation?.status || p.annotation.status === "unknown").length;
  const obsoleteCount = projects.filter((p) => p.annotation?.status === "obsolete").length;
  const archivedCount = projects.filter((p) => p.annotation?.status === "archived").length;

  // Severity stats
  const critical = projects.filter((p) => p.risk === 3).length;
  const warn = projects.filter((p) => p.risk === 2).length;
  const info = projects.filter((p) => p.risk === 1).length;
  const ok = projects.filter((p) => p.risk === 0).length;

  // Repo footprint / sync facts
  const noRemote = projects.filter((p) => p.hasRemote === false && p.isGit === true).length;
  const untracked = projects.filter((p) => p.kind === "orphan").length;
  const reclaimable = projects.reduce((sum, p) => sum + (p.disposableBytes ?? 0), 0);

  const toggleSeverity = (severity: FlagSeverity) => () => onToggleSeverity(severity);
  const isSeverityActive = (severity: FlagSeverity) => activeSeverities.includes(severity);

  const toggleStatus = (status: ProjectStatus) => (onToggleStatus ? () => onToggleStatus(status) : undefined);
  const isStatusActive = (status: ProjectStatus) => activeStatuses.includes(status);

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-surface px-5 py-3">
      {/* Overview */}
      <Card label="Projects" value={projects.length} />

      {/* Project Status */}
      <div className="hidden sm:block h-9 w-px bg-border/60 mx-0.5" />
      <Card
        label="Active"
        value={activeCount}
        color="text-good"
        active={isStatusActive("active")}
        onClick={toggleStatus("active")}
      />
      <Card
        label="Stale"
        value={staleCount}
        color="text-warn"
        active={isStatusActive("stale")}
        onClick={toggleStatus("stale")}
      />
      <Card
        label="Unknown"
        value={unknownCount}
        color="text-muted"
        active={isStatusActive("unknown")}
        onClick={toggleStatus("unknown")}
      />
      <Card
        label="Obsolete"
        value={obsoleteCount}
        color="text-muted/80"
        active={isStatusActive("obsolete")}
        onClick={toggleStatus("obsolete")}
      />
      <Card
        label="Archived"
        value={archivedCount}
        color="text-muted/60"
        active={isStatusActive("archived")}
        onClick={toggleStatus("archived")}
      />

      {/* Severity / Health */}
      <div className="hidden sm:block h-9 w-px bg-border/60 mx-0.5" />
      <Card
        label="Critical"
        value={critical}
        color="text-critical"
        active={isSeverityActive("critical")}
        onClick={toggleSeverity("critical")}
      />
      <Card
        label="Warn"
        value={warn}
        color="text-warn"
        active={isSeverityActive("warn")}
        onClick={toggleSeverity("warn")}
      />
      <Card
        label="Info"
        value={info}
        color="text-info"
        active={isSeverityActive("info")}
        onClick={toggleSeverity("info")}
      />
      <Card
        label="OK"
        value={ok}
        color="text-good"
        active={isSeverityActive("good")}
        onClick={toggleSeverity("good")}
      />

      {/* Details */}
      <div className="hidden sm:block h-9 w-px bg-border/60 mx-0.5" />
      <Card label="No remote" value={noRemote} />
      <Card label="Untracked" value={untracked} />
      <Card label="Reclaimable" value={formatBytes(reclaimable)} />
    </div>
  );
}
