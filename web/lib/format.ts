import type { FlagSeverity, Project } from "../../core/types.ts";

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  return `${value.toFixed(1)} ${units[unitIdx]}`;
}

export function formatAge(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  if (days === 0) return "today";
  if (days < 31) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${years}y`;
}

export function formatTimeAgo(
  dateInput: string | Date | number | null | undefined,
  now = Date.now(),
): string | null {
  if (!dateInput) return null;
  const time = dateInput instanceof Date ? dateInput.getTime() : new Date(dateInput).getTime();
  if (Number.isNaN(time)) return null;
  const diffSec = Math.floor((now - time) / 1000);
  if (diffSec < 60) return "< 1m ago";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatSync(project: Project): string {
  if (!project.hasRemote) return "local-only";
  if (project.noUpstream) return "no upstream";
  const ahead = project.ahead ?? 0;
  const behind = project.behind ?? 0;
  if (ahead > 0 && behind > 0) return `↑${ahead} ↓${behind}`;
  if (ahead > 0) return `↑${ahead}`;
  if (behind > 0) return `↓${behind}`;
  return "in sync";
}

export function severityColor(severity: FlagSeverity): string {
  switch (severity) {
    case "critical":
      return "text-critical";
    case "warn":
      return "text-warn";
    case "info":
      return "text-info";
    case "good":
      return "text-good";
    default:
      return "text-muted";
  }
}
