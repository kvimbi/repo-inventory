import React, { useState } from "react";
import type { Project } from "../../core/types.ts";
import type { SortKey } from "../lib/filter.ts";
import { ProjectRow } from "./ProjectRow.tsx";

interface ProjectTableProps {
  projects: Project[];
  totalCount?: number;
  sortKey: SortKey;
  sortDescending: boolean;
  selectedId: string | null;
  checkedIds: Set<string>;
  onSort: (key: SortKey) => void;
  onSelect: (id: string) => void;
  onToggleChecked: (id: string, rangeIds?: string[]) => void;
  onToggleAll: () => void;
  onToggleFavourite: (project: Project, e: React.MouseEvent) => void;
  onToggleTodo?: (project: Project, e: React.MouseEvent) => void;
}

const HEADERS: Array<{ key?: SortKey; label: string; align?: "left" | "right" | "center" }> = [
  { label: "", align: "center" }, // checkbox
  { label: "★", align: "center" }, // favourite star
  { label: "☐", align: "center" }, // todo checkbox
  { key: "risk", label: "", align: "center" },
  { key: "name", label: "Project", align: "left" },
  { key: "group", label: "Group", align: "left" },
  { label: "Kind", align: "left" },
  { label: "Stack", align: "left" },
  { label: "Branch", align: "left" },
  { label: "Sync", align: "left" },
  { key: "commits90d", label: "Commits 90d", align: "right" },
  { key: "lastCommit", label: "Last commit", align: "right" },
  { key: "size", label: "Size", align: "right" },
  { key: "status", label: "Status", align: "left" },
  { label: "Flags", align: "left" },
];

export function ProjectTable({
  projects,
  totalCount,
  sortKey,
  sortDescending,
  selectedId,
  checkedIds,
  onSort,
  onSelect,
  onToggleChecked,
  onToggleAll,
  onToggleFavourite,
  onToggleTodo,
}: ProjectTableProps) {
  // Monorepo rows: collapsed by default, expandable per root
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [lastCheckedId, setLastCheckedId] = useState<string | null>(null);

  const handleToggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build top-level vs sub-project map
  const subProjectsByParent = new Map<string, Project[]>();
  const topLevelProjects: Project[] = [];
  const knownTopLevelIds = new Set<string>();

  for (const p of projects) {
    if (!p.monorepoRootId) {
      topLevelProjects.push(p);
      knownTopLevelIds.add(p.id);
    }
  }

  for (const p of projects) {
    if (p.monorepoRootId) {
      if (knownTopLevelIds.has(p.monorepoRootId)) {
        const list = subProjectsByParent.get(p.monorepoRootId) ?? [];
        list.push(p);
        subProjectsByParent.set(p.monorepoRootId, list);
      } else {
        // Fallback: parent not present in topLevelProjects, render sub-project directly
        topLevelProjects.push(p);
      }
    }
  }

  // Auto-expand parent when a child sub-project is selected (e.g. from favourites)
  React.useEffect(() => {
    if (!selectedId) return;
    for (const [parentId, children] of subProjectsByParent.entries()) {
      if (children.some((c) => c.id === selectedId)) {
        setExpandedIds((prev) => {
          if (prev.has(parentId)) return prev;
          const next = new Set(prev);
          next.add(parentId);
          return next;
        });
      }
    }
  }, [selectedId, projects]);

  // Ordered visible projects list for Shift-Click range calculation
  const displayedProjects: Project[] = [];
  for (const p of topLevelProjects) {
    displayedProjects.push(p);
    const children = subProjectsByParent.get(p.id) ?? [];
    const isExpanded = expandedIds.has(p.id);
    if (isExpanded) {
      for (const subP of children) {
        displayedProjects.push(subP);
      }
    }
  }

  const handleRowToggleChecked = (id: string, e?: React.MouseEvent) => {
    if (e?.shiftKey && lastCheckedId) {
      const fromIdx = displayedProjects.findIndex((p) => p.id === lastCheckedId);
      const toIdx = displayedProjects.findIndex((p) => p.id === id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        const range = displayedProjects.slice(start, end + 1).map((p) => p.id);
        onToggleChecked(id, range);
        setLastCheckedId(id);
        return;
      }
    }
    setLastCheckedId(id);
    onToggleChecked(id);
  };

  const allVisibleChecked = projects.length > 0 && projects.every((p) => checkedIds.has(p.id));
  const someVisibleChecked = projects.some((p) => checkedIds.has(p.id)) && !allVisibleChecked;

  const handleClick = (key?: SortKey) => {
    if (key) onSort(key);
  };

  const isNoProjects = totalCount === 0 || (totalCount === undefined && projects.length === 0);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-panel shadow-sm">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-border bg-surface text-muted">
          <tr>
            {HEADERS.map((h, i) => {
              if (i === 0) {
                return (
                  <th key="check-all" className="w-10 px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={allVisibleChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleChecked;
                      }}
                      onChange={onToggleAll}
                      className="rounded border-border text-info focus:ring-info/30 cursor-pointer"
                      title="Select all visible"
                    />
                  </th>
                );
              }

              const isSorted = h.key === sortKey;
              return (
                <th
                  key={h.label || h.key || `col-${i}`}
                  onClick={() => handleClick(h.key)}
                  className={`px-3 py-2.5 font-semibold transition-colors ${
                    h.key ? "cursor-pointer hover:bg-surface-hover hover:text-ink select-none" : ""
                  } ${isSorted ? "text-info font-bold" : ""} ${
                    h.align === "right" ? "text-right" : h.align === "center" ? "text-center" : "text-left"
                  }`}
                  title={h.key ? `Sort by ${h.label || h.key}` : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {h.label}
                    {isSorted && (
                      <span className="text-info font-bold">
                        {sortDescending ? "↓" : "↑"}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {topLevelProjects.length === 0 ? (
            <tr>
              <td colSpan={HEADERS.length} className="py-12 text-center text-muted">
                <div className="flex flex-col items-center justify-center gap-1">
                  <span className="text-sm font-medium">
                    {isNoProjects ? "No projects found in inventory" : "No projects match the selected filters"}
                  </span>
                  <span className="text-xs text-muted/70">
                    {isNoProjects ? "Click Re-scan to scan your repositories." : "Try adjusting your query or resetting filter presets."}
                  </span>
                </div>
              </td>
            </tr>
          ) : (
            topLevelProjects.map((p) => {
              const children = subProjectsByParent.get(p.id) ?? [];
              const isExpanded = expandedIds.has(p.id);

              return (
                <React.Fragment key={p.relPath || p.id}>
                  <ProjectRow
                    project={p}
                    selected={selectedId === p.id}
                    checked={checkedIds.has(p.id)}
                    isExpanded={isExpanded}
                    onSelect={onSelect}
                    onToggleChecked={handleRowToggleChecked}
                    onToggleFavourite={onToggleFavourite}
                    onToggleTodo={onToggleTodo}
                    onToggleExpand={handleToggleExpand}
                  />
                  {isExpanded &&
                    children.map((subP) => (
                      <ProjectRow
                        key={subP.relPath || subP.id}
                        project={subP}
                        selected={selectedId === subP.id}
                        checked={checkedIds.has(subP.id)}
                        isSubRow={true}
                        onSelect={onSelect}
                        onToggleChecked={handleRowToggleChecked}
                        onToggleFavourite={onToggleFavourite}
                        onToggleTodo={onToggleTodo}
                      />
                    ))}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
