import type { Project, FlagSeverity, ProjectStatus } from "../../core/types.ts";

export interface Filters {
  query: string;
  groups: string[];
  statuses: ProjectStatus[];
  severities: FlagSeverity[];
  stacks: string[];
  rules: string[];
  projectTypes: Array<"standalone" | "monorepo-root" | "sub-project">;
  todoOnly: boolean;
  hasSkills: boolean;
  hideResolved: boolean;
}

export type SortKey = "status" | "risk" | "name" | "group" | "lastCommit" | "size" | "commits90d";

export const EMPTY_FILTERS: Filters = {
  query: "",
  groups: [],
  statuses: [],
  severities: [],
  stacks: [],
  rules: [],
  projectTypes: [],
  todoOnly: false,
  hasSkills: false,
  hideResolved: true,
};

export function filterProjects(projects: Project[], filters: Filters): Project[] {
  function matchesDirectly(p: Project): boolean {
    // Hide resolved first (unless obsolete or archived are explicitly filtered)
    if (
      filters.hideResolved &&
      !filters.statuses.includes("obsolete") &&
      !filters.statuses.includes("archived") &&
      (p.annotation.status === "obsolete" || p.annotation.status === "archived")
    ) {
      return false;
    }

    // Todo filter
    if (filters.todoOnly && !p.annotation.todo) {
      return false;
    }

    // Skills filter
    if (filters.hasSkills && (!p.skills || p.skills.length === 0)) {
      return false;
    }

    // Project type filter
    if (filters.projectTypes && filters.projectTypes.length > 0) {
      if (!p.projectType || !filters.projectTypes.includes(p.projectType)) {
        return false;
      }
    }

    // Groups filter
    if (filters.groups.length > 0 && !filters.groups.includes(p.group)) {
      return false;
    }

    // Statuses filter
    if (filters.statuses.length > 0 && !filters.statuses.includes((p.annotation.status ?? "unknown") as never)) {
      return false;
    }

    // Severities filter - match project's highest severity (from risk)
    if (filters.severities.length > 0) {
      const sev = riskToSeverity(p.risk);
      if (!filters.severities.includes(sev)) {
        return false;
      }
    }

    // Stacks filter - project matches if it has ANY of these
    if (filters.stacks.length > 0 && !p.stack?.some((s) => filters.stacks.includes(s))) {
      return false;
    }

    // Rules filter - project matches if it has ANY of these flags
    if (filters.rules.length > 0 && !p.flags.some((f) => filters.rules.includes(f.rule))) {
      return false;
    }

    // Query filter (name, alias, note, relPath, stack, frameworks, skills)
    if (filters.query) {
      const q = filters.query.toLowerCase();
      const match =
        p.name.toLowerCase().includes(q) ||
        (p.annotation.alias && p.annotation.alias.toLowerCase().includes(q)) ||
        (p.annotation.note && p.annotation.note.toLowerCase().includes(q)) ||
        p.relPath.toLowerCase().includes(q) ||
        p.stack?.some((s) => s.toLowerCase().includes(q)) ||
        p.frameworks?.some((f) => f.toLowerCase().includes(q)) ||
        p.skills?.some((s) => s.name.toLowerCase().includes(q) || (s.description && s.description.toLowerCase().includes(q)));
      if (!match) return false;
    }

    return true;
  }

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const directlyMatchedIds = new Set<string>();

  for (const p of projects) {
    if (matchesDirectly(p)) {
      directlyMatchedIds.add(p.id);
    }
  }

  // Include parent monorepo roots when any of their subprojects match,
  // so the parent-child hierarchy in the table can render matching subprojects.
  const includedIds = new Set(directlyMatchedIds);
  for (const id of directlyMatchedIds) {
    const p = projectMap.get(id);
    if (p?.monorepoRootId) {
      includedIds.add(p.monorepoRootId);
    }
  }

  return projects.filter((p) => includedIds.has(p.id));
}

function getSortName(p: Project): string {
  return p.annotation.alias?.trim() || p.name;
}

function riskToSeverity(risk: number): FlagSeverity {
  switch (risk) {
    case 3: return "critical";
    case 2: return "warn";
    case 1: return "info";
    default: return "good";
  }
}

const STATUS_ORDER: Record<ProjectStatus, number> = {
  active: 0,
  stale: 1,
  unknown: 2,
  obsolete: 3,
  archived: 4,
};

export function sortProjects(projects: Project[], key: SortKey, descending: boolean): Project[] {
  const arr = [...projects];
  arr.sort((a, b) => {
    let comparison = 0;
    switch (key) {
      case "status": {
        const orderA = STATUS_ORDER[a.annotation.status] ?? 99;
        const orderB = STATUS_ORDER[b.annotation.status] ?? 99;
        comparison = orderA - orderB;
        if (comparison === 0) comparison = getSortName(a).localeCompare(getSortName(b));
        break;
      }
      case "risk":
        comparison = (a.risk ?? 0) - (b.risk ?? 0);
        break;
      case "name":
        comparison = getSortName(a).localeCompare(getSortName(b));
        break;
      case "group":
        comparison = a.group.localeCompare(b.group);
        if (comparison === 0) comparison = getSortName(a).localeCompare(getSortName(b));
        break;
      case "lastCommit":
        comparison = compareNullable(a.lastCommitAgeDays, b.lastCommitAgeDays);
        break;
      case "size":
        comparison = compareNullable(a.sourceBytes, b.sourceBytes);
        break;
      case "commits90d":
        comparison = compareNullable(
          (a as { commits90d?: number }).commits90d,
          (b as { commits90d?: number }).commits90d,
        );
        break;
    }
    if (comparison === 0) {
      comparison = a.relPath.localeCompare(b.relPath);
    }
    return descending ? -comparison : comparison;
  });
  return arr;
}

function compareNullable(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls sort last
  if (b == null) return -1;
  return a - b;
}

export interface Facets {
  groups: Array<{ value: string; count: number }>;
  stacks: Array<{ value: string; count: number }>;
  rules: Array<{ value: string; count: number; severity: FlagSeverity }>;
  skillsCount: number;
}

export function computeFacets(projects: Project[]): Facets {
  const groupCounts = new Map<string, number>();
  const stackCounts = new Map<string, number>();
  const ruleMap = new Map<string, { count: number; severity: FlagSeverity }>();
  let skillsCount = 0;

  for (const p of projects) {
    if ((p.skills?.length ?? 0) > 0) {
      skillsCount++;
    }

    // Groups
    groupCounts.set(p.group, (groupCounts.get(p.group) ?? 0) + 1);

    // Stacks
    for (const s of p.stack ?? []) {
      stackCounts.set(s, (stackCounts.get(s) ?? 0) + 1);
    }

    // Rules
    for (const f of p.flags) {
      if (f.rule === "HEALTHY") continue;
      const existing = ruleMap.get(f.rule);
      if (existing) {
        existing.count++;
      } else {
        ruleMap.set(f.rule, { count: 1, severity: f.severity });
      }
    }
  }

  const groups = Array.from(groupCounts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value));

  const stacks = Array.from(stackCounts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value));

  const rules = Array.from(ruleMap.entries())
    .map(([value, { count, severity }]) => ({ value, count, severity }))
    .sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value));

  return { groups, stacks, rules, skillsCount };
}
