import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  fetchInventory,
  quickRefresh,
  runScan,
  generateScript,
  saveAnnotation,
  rescanSingleProject,
  subscribeScanProgress,
} from "../../apiClient.ts";
import { SummaryBar } from "../../components/SummaryBar.tsx";
import { FavouritesRow } from "../../components/FavouritesRow.tsx";
import { FilterBar } from "../../components/FilterBar.tsx";
import { ProjectTable } from "../../components/ProjectTable.tsx";
import { DetailPanel } from "../../components/DetailPanel.tsx";
import { MultiDetailPanel } from "../../components/MultiDetailPanel.tsx";
import { SelectionBar } from "../../components/SelectionBar.tsx";
import { ScriptModal } from "../../components/ScriptModal.tsx";
import { ChatModal } from "../../components/ChatModal.tsx";
import { SkillsModal } from "../../components/SkillsModal.tsx";
import { LoadingScreen } from "../../components/LoadingScreen.tsx";
import { GuidanceReviewModal } from "../../components/GuidanceReviewModal.tsx";
import { EMPTY_FILTERS, filterProjects, sortProjects, computeFacets, type Filters, type SortKey } from "../../lib/filter.ts";
import type { Inventory, Project, FlagSeverity, ProjectStatus, ScanProgress } from "../../../core/types.ts";
import { isElectron } from "../../electronBridge.ts";

export interface ProjectsHeaderState {
  inventory: Inventory | null;
  busy: "loading" | "scanning" | null;
  scanProgress: ScanProgress | null;
  onQuickRefresh: () => void;
  onFullRescan: (fetchRemotes: boolean) => void;
  onOpenChat: () => void;
  onOpenSkills: () => void;
}

export interface ProjectsViewProps {
  onHeaderStateChange?: (state: ProjectsHeaderState) => void;
  registerRescanHandler?: (handler: (fetchRemotes: boolean) => Promise<void>) => void;
  selectedProjectId?: string | null;
}

export function ProjectsView({ onHeaderStateChange, registerRescanHandler, selectedProjectId }: ProjectsViewProps) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"loading" | "scanning" | null>("loading");
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDescending, setSortDescending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [script, setScript] = useState<{ action: { name: string; label: string; description: string }; result: { script: string; included: string[]; skipped: string[] } } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [guidanceProject, setGuidanceProject] = useState<Project | null>(null);
  const startupRefreshStarted = useRef(false);
  const startupFullScanObserved = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (selectedProjectId) {
      setSelectedId(selectedProjectId);
    }
  }, [selectedProjectId]);

  const handleQuickRefresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setBusy("scanning");
    setError(null);
    try {
      const inv = await quickRefresh();
      if (mountedRef.current) setInventory(inv);
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const unsubProgress = subscribeScanProgress((progress) => {
      setScanProgress(progress);
      if (progress.phase === "discovering" || progress.phase === "probing" || progress.phase === "evaluating") {
        startupFullScanObserved.current = true;
      }
    });

    startupFullScanObserved.current = false;
    fetchInventory()
      .then((inv) => {
        if (!mountedRef.current) return;
        setInventory(inv);
        if (!isElectron() || startupFullScanObserved.current) {
          setBusy(null);
          return;
        }
        if (startupRefreshStarted.current) return;
        startupRefreshStarted.current = true;
        void handleQuickRefresh();
      })
      .catch((e) => {
        if (!mountedRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setBusy(null);
      });

    return () => {
      mountedRef.current = false;
      unsubProgress();
    };
  }, [handleQuickRefresh]);

  const handleScan = useCallback(async (fetchRemotes: boolean) => {
    setBusy("scanning");
    setError(null);
    try {
      const inv = await runScan(fetchRemotes);
      setInventory(inv);
      setCheckedIds(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    registerRescanHandler?.(handleScan);
  }, [registerRescanHandler, handleScan]);

  const handleOpenChat = useCallback(() => setChatOpen(true), []);
  const handleOpenSkills = useCallback(() => setSkillsOpen(true), []);

  useEffect(() => {
    onHeaderStateChange?.({
      inventory,
      busy,
      scanProgress,
      onQuickRefresh: handleQuickRefresh,
      onFullRescan: handleScan,
      onOpenChat: handleOpenChat,
      onOpenSkills: handleOpenSkills,
    });
  }, [
    inventory,
    busy,
    scanProgress,
    handleQuickRefresh,
    handleScan,
    handleOpenChat,
    handleOpenSkills,
    onHeaderStateChange,
  ]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (checkedIds.size > 0) {
          setCheckedIds(new Set());
        } else {
          setSelectedId(null);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [checkedIds.size]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setChatOpen((prev) => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        handleScan(false);
      } else if (isElectron() && (e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        handleQuickRefresh();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleScan, handleQuickRefresh]);

  const projects = inventory?.projects ?? [];
  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  const handleRescanProject = useCallback(
    async (id: string, fetchRemotes: boolean = true) => {
      setError(null);
      try {
        const res = await rescanSingleProject(id, fetchRemotes);
        if (res.inventory) {
          setInventory(res.inventory);
        } else if (res.project && inventory) {
          const idx = inventory.projects.findIndex((p) => p.id === id || p.path === res.project!.path);
          if (idx !== -1) {
            const newProjects = [...inventory.projects];
            newProjects[idx] = res.project;
            setInventory({ ...inventory, projects: newProjects });
          }
        }
        if (res.project) {
          if (selectedId === id || (selected && selected.path === res.project.path)) {
            setSelectedId(res.project.id);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
    [inventory, selectedId, selected],
  );

  const handleAnnotationSaved = useCallback(
    (project: Project) => {
      if (!inventory) return;
      const idx = inventory.projects.findIndex((p) => p.id === project.id || p.path === project.path);
      if (idx !== -1) return;
      const newProjects = [...inventory.projects];
      newProjects[idx] = project;
      setInventory({ ...inventory, projects: newProjects });
      if (selectedId && selected && selected.path === project.path && selectedId !== project.id) {
        setSelectedId(project.id);
      }
    },
    [inventory, selectedId, selected],
  );

  const handleBatchAnnotationSaved = useCallback(
    (updatedProjects: Project[]) => {
      if (!inventory) return;
      const updatedMap = new Map(updatedProjects.map((p) => [p.id, p]));
      const newProjects = inventory.projects.map((p) => updatedMap.get(p.id) ?? p);
      setInventory({ ...inventory, projects: newProjects });
    },
    [inventory],
  );

  const handleToggleFavourite = useCallback(
    async (project: Project, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!inventory) return;
      const nextFavourite = !project.annotation.favourite;
      try {
        const result = await saveAnnotation(project.id, { favourite: nextFavourite });
        if (result.project) {
          handleAnnotationSaved(result.project);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [inventory, handleAnnotationSaved],
  );

  const handleToggleTodo = useCallback(
    async (project: Project, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!inventory) return;
      const nextTodo = !project.annotation.todo;
      try {
        const result = await saveAnnotation(project.id, { todo: nextTodo });
        if (result.project) {
          handleAnnotationSaved(result.project);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [inventory, handleAnnotationSaved],
  );

  const handleToggleSeverity = useCallback((severity: FlagSeverity) => {
    setFilters((prev) => {
      const has = prev.severities.includes(severity);
      if (has) {
        return { ...prev, severities: prev.severities.filter((s) => s !== severity) };
      }
      return { ...prev, severities: [...prev.severities, severity] };
    });
  }, []);

  const handleToggleStatus = useCallback((status: ProjectStatus) => {
    setFilters((prev) => {
      const has = prev.statuses.includes(status);
      if (has) {
        return { ...prev, statuses: prev.statuses.filter((s) => s !== status) };
      }
      return { ...prev, statuses: [...prev.statuses, status] };
    });
  }, []);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDescending((d) => !d);
        return prev;
      }
      setSortDescending(true);
      return key;
    });
  }, []);

  const toggleChecked = useCallback((id: string, rangeIds?: string[]) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (rangeIds && rangeIds.length > 0) {
        for (const rid of rangeIds) {
          next.add(rid);
        }
      } else {
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }, []);

  const handleUncheckProject = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const visible = useMemo(
    () => sortProjects(filterProjects(projects, filters), sortKey, sortDescending),
    [projects, filters, sortKey, sortDescending],
  );

  const toggleAll = useCallback(() => {
    setCheckedIds((prev) => {
      const visibleIds = visible.map((p) => p.id);
      const allChecked = visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allChecked) {
        for (const id of visibleIds) {
          next.delete(id);
        }
      } else {
        for (const id of visibleIds) {
          next.add(id);
        }
      }
      return next;
    });
  }, [visible]);

  const handleGenerate = useCallback(
    async (actionName: string, overrideIds?: string[]) => {
      if (!inventory) return;
      setGenerating(true);
      setError(null);
      try {
        const action = inventory.actions.find((a) => a.name === actionName);
        if (!action) throw new Error(`Action ${actionName} not found`);
        const targetIds = overrideIds ?? [...checkedIds];
        const result = await generateScript(actionName, targetIds);
        setScript({ action, result });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setGenerating(false);
      }
    },
    [inventory, checkedIds],
  );

  const facets = useMemo(() => computeFacets(projects), [projects]);

  const checkedProjects = useMemo(
    () => projects.filter((p) => checkedIds.has(p.id)),
    [projects, checkedIds],
  );

  if (busy === "loading" && !inventory) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden">
        <LoadingScreen
          progress={scanProgress}
          error={error}
          showHeader={false}
          onRetry={() => {
            setError(null);
            setBusy("loading");
            fetchInventory()
              .then((inv) => {
                setInventory(inv);
                setBusy(null);
              })
              .catch((e) => {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(null);
              });
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {busy === "scanning" && (
        <div className="relative h-1 w-full bg-border overflow-hidden">
          {scanProgress?.total && scanProgress.total > 0 ? (
            <div
              className="h-full bg-gradient-to-r from-info to-good transition-all duration-150"
              style={{
                width: `${Math.min(100, Math.round(((scanProgress.done ?? 0) / scanProgress.total) * 100))}%`,
              }}
            />
          ) : (
            <div className="h-full w-1/3 bg-info animate-indeterminate rounded-full" />
          )}
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between border-b border-border bg-critical/10 px-5 py-2 text-sm text-critical">
          <span>{error}</span>
          <button className="text-xs underline cursor-pointer" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {inventory && (
        <SummaryBar
          projects={projects}
          activeSeverities={filters.severities}
          onToggleSeverity={handleToggleSeverity}
          activeStatuses={filters.statuses}
          onToggleStatus={handleToggleStatus}
        />
      )}
      {inventory && (
        <FavouritesRow
          projects={projects}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleFavourite={handleToggleFavourite}
        />
      )}
      {inventory && (
        <FilterBar
          filters={filters}
          facets={facets}
          visibleCount={visible.length}
          totalCount={projects.length}
          onChange={setFilters}
        />
      )}
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-auto">
          <div className="flex-1 p-5">
            {inventory && (
              <ProjectTable
                projects={visible}
                totalCount={projects.length}
                sortKey={sortKey}
                sortDescending={sortDescending}
                selectedId={selectedId}
                checkedIds={checkedIds}
                onSort={handleSort}
                onSelect={setSelectedId}
                onToggleChecked={toggleChecked}
                onToggleAll={toggleAll}
                onToggleFavourite={handleToggleFavourite}
                onToggleTodo={handleToggleTodo}
              />
            )}
          </div>
          {inventory && (
            <SelectionBar
              checkedProjects={checkedProjects}
              actions={inventory.actions}
              onClear={() => setCheckedIds(new Set())}
              onGenerate={handleGenerate}
              busy={generating}
            />
          )}
        </div>
        {checkedProjects.length > 1 ? (
          <MultiDetailPanel
            projects={checkedProjects}
            actions={inventory?.actions}
            onClose={() => setCheckedIds(new Set())}
            onSavedBatch={handleBatchAnnotationSaved}
            onUncheckProject={handleUncheckProject}
            onRescanProject={handleRescanProject}
            onGenerateScript={handleGenerate}
          />
        ) : checkedProjects.length === 1 ? (
          <DetailPanel
            project={checkedProjects[0]}
            onClose={() => setCheckedIds(new Set())}
            onSaved={handleAnnotationSaved}
            onRescanProject={handleRescanProject}
            onGenerateScript={handleGenerate}
            onImproveGuidance={setGuidanceProject}
          />
        ) : selected ? (
          <DetailPanel
            project={selected}
            onClose={() => setSelectedId(null)}
            onSaved={handleAnnotationSaved}
            onRescanProject={handleRescanProject}
            onGenerateScript={handleGenerate}
            onImproveGuidance={setGuidanceProject}
          />
        ) : null}
      </main>
      {script && (
        <ScriptModal
          action={script.action}
          result={script.result}
          onClose={() => setScript(null)}
        />
      )}
      {chatOpen && <ChatModal projects={projects} selectedProject={selected} onClose={() => setChatOpen(false)} />}
      {skillsOpen && (
        <SkillsModal
          projects={projects}
          onClose={() => setSkillsOpen(false)}
          onSelectProject={(id) => {
            setSelectedId(id);
            setCheckedIds(new Set());
          }}
        />
      )}
      {guidanceProject && <GuidanceReviewModal project={guidanceProject} onClose={() => setGuidanceProject(null)} />}
    </div>
  );
}
