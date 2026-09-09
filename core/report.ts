import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Inventory, Project, Flag } from "./types.ts";

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

function escapePipe(str: string): string {
  return str.replace(/\|/g, "\\|");
}

function getSyncStatus(p: Project): string {
  if (!p.hasRemote) return "local-only";
  if (p.noUpstream) return "no upstream";
  const ahead = p.ahead ?? 0;
  const behind = p.behind ?? 0;
  if (ahead > 0 && behind > 0) return `↑${ahead} ↓${behind}`;
  if (ahead > 0) return `↑${ahead}`;
  if (behind > 0) return `↓${behind}`;
  return "in sync";
}

function getStatusWithSnooze(p: Project): string {
  let s = p.annotation.status;
  if (p.annotation.snoozedUntil) {
    const snoozeDate = new Date(p.annotation.snoozedUntil);
    if (snoozeDate.getTime() > Date.now()) {
      s += " (snoozed)";
    }
  }
  return s;
}

function formatCriticalFlags(flags: Flag[]): string {
  const critical = flags.filter((f) => f.severity === "critical");
  if (critical.length === 0) return "—";
  return critical
    .map((f) => {
      const detail = f.detail ? ` (${escapePipe(f.detail)})` : "";
      return `**${escapePipe(f.label)}**${detail}`;
    })
    .join("<br>");
}

function formatFlagsForGroup(flags: Flag[]): string {
  const nonHealthy = flags.filter((f) => f.rule !== "HEALTHY");
  if (nonHealthy.length === 0) {
    // Check if there's a HEALTHY flag
    if (flags.some((f) => f.rule === "HEALTHY")) {
      return "healthy";
    }
    return "—";
  }
  return nonHealthy.map((f) => f.rule).join(", ");
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  return map;
}

export function renderMarkdown(inventory: Inventory): string {
  const lines: string[] = [];

  // Header
  const scannedDate = new Date(inventory.scannedAt);
  const dateStr = scannedDate.toISOString().slice(0, 16).replace("T", " ");
  const seconds = (inventory.durationMs / 1000).toFixed(1);
  const remoteState = inventory.fetched ? "fresh" : "stale";
  const remoteNote = inventory.fetched ? "(fetched)" : "(no fetch)";

  lines.push("# Code inventory");
  lines.push("");
  lines.push(
    `Scanned \`${inventory.root}\` at ${dateStr} — ${inventory.projects.length} projects in ${seconds}s.`
  );
  lines.push(`Remote state: **${remoteState}** ${remoteNote}`);
  lines.push("");

  // Summary
  const projects = inventory.projects;
  const gitRepos = projects.filter((p) => p.isGit).length;
  const orphans = projects.filter((p) => p.kind === "orphan").length;
  const worktrees = projects.filter((p) => p.kind === "worktree" || p.kind === "submodule").length;
  const noRemote = projects.filter((p) => p.isGit && !p.hasRemote).length;
  const uncommitted = projects.filter((p) => (p.dirtyFiles ?? 0) > 0).length;
  const unpushed = projects.filter((p) => (p.ahead ?? 0) > 0).length;
  const stale = projects.filter((p) => (p.lastCommitAgeDays ?? 0) >= 180).length;
  const markedStale = projects.filter((p) => p.annotation.status === "stale").length;
  const markedObsolete = projects.filter((p) => p.annotation.status === "obsolete").length;
  const markedArchived = projects.filter((p) => p.annotation.status === "archived").length;
  const reclaimable = projects.reduce((sum, p) => sum + (p.disposableBytes ?? 0), 0);

  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|---|---:|");
  lines.push(`| Projects | ${projects.length} |`);
  lines.push(`| Git repositories | ${gitRepos} |`);
  lines.push(`| Untracked project folders | ${orphans} |`);
  lines.push(`| Worktrees / submodules | ${worktrees} |`);
  lines.push(`| Without a remote | ${noRemote} |`);
  lines.push(`| With uncommitted changes | ${uncommitted} |`);
  lines.push(`| With unpushed commits | ${unpushed} |`);
  lines.push(`| Stale (>180d) | ${stale} |`);
  lines.push(`| Marked stale | ${markedStale} |`);
  lines.push(`| Marked obsolete | ${markedObsolete} |`);
  lines.push(`| Marked archived | ${markedArchived} |`);
  lines.push(`| Reclaimable build output | ${formatBytes(reclaimable)} |`);
  lines.push("");

  // Needs attention
  const critical = projects.filter((p) => p.risk === 3);
  lines.push("## Needs attention");
  lines.push("");
  if (critical.length === 0) {
    lines.push("No projects with critical flags.");
  } else {
    lines.push("Projects with at least one critical flag, worst first.");
    lines.push("");
    lines.push("| Project | Kind | Stack | Last commit | Flags |");
    lines.push("|---|---|---|---:|---|");
    for (const p of critical) {
      const stack = (p.stack ?? []).join(", ") || "—";
      const age = formatAge(p.lastCommitAgeDays ?? null);
      const flags = formatCriticalFlags(p.flags);
      lines.push(`| \`${p.relPath}\` | ${p.kind} | ${stack} | ${age} | ${flags} |`);
    }
  }
  lines.push("");

  // By group
  lines.push("## By group");
  lines.push("");

  const byGroup = groupBy(projects, (p) => p.group);
  const groups = Array.from(byGroup.keys()).sort((a, b) => {
    if (a === "(root)") return 1;
    if (b === "(root)") return -1;
    return a.localeCompare(b);
  });

  for (const group of groups) {
    const groupProjects = byGroup.get(group)!;
    lines.push(`### ${group} — ${groupProjects.length} projects`);
    lines.push("");
    lines.push(
      "| Project | Kind | Stack | Branch | Sync | Last commit | Size | Status | Flags |"
    );
    lines.push("|---|---|---|---|---|---:|---:|---|---|");

    const notes: string[] = [];
    for (const p of groupProjects) {
      const relName = p.relPath.startsWith(`${group}/`) ? p.relPath.slice(group.length + 1) : p.name;
      const displayName = p.annotation.alias ? `**${p.annotation.alias}** (\`${relName}\`)` : `\`${relName}\``;
      const stack = (p.stack ?? []).join(", ") || "—";
      const branch = p.branch ?? "(detached)";
      const sync = getSyncStatus(p);
      const age = formatAge(p.lastCommitAgeDays ?? null);
      const size = formatBytes(p.sourceBytes);
      const status = getStatusWithSnooze(p);
      const flags = formatFlagsForGroup(p.flags);
      lines.push(
        `| ${displayName} | ${p.kind} | ${stack} | ${branch} | ${sync} | ${age} | ${size} | ${status} | ${flags} |`
      );
      if (p.annotation.note && p.annotation.note.trim()) {
        const label = p.annotation.alias ? `**${p.annotation.alias}** (\`${relName}\`)` : `\`${relName}\``;
        notes.push(`> ${label} — ${p.annotation.note}`);
      }
    }

    if (notes.length > 0) {
      lines.push("");
      for (const note of notes) {
        lines.push(note);
      }
    }
    lines.push("");
  }

  // Footer
  lines.push("---");
  const probeList = inventory.probes.join(", ");
  const ruleCount = inventory.rules.length;
  const actionCount = inventory.actions.length;
  lines.push(
    `Generated by repo-inventory. Probes: ${probeList} · Rules: ${ruleCount} · Actions: ${actionCount}`
  );
  lines.push("");

  return lines.join("\n");
}

export async function writeReport(baseDir: string, inventory: Inventory): Promise<string> {
  const md = renderMarkdown(inventory);
  const path = resolve(baseDir, "INVENTORY.md");
  await writeFile(path, md, "utf-8");
  return path;
}
