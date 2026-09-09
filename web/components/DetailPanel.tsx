import { useEffect, useState } from "react";
import type { Project } from "../../core/types.ts";
import { IDE_LAUNCHERS } from "../../core/ides.ts";
import { AnnotationEditor } from "./AnnotationEditor.tsx";
import { FactList } from "./FactList.tsx";
import { DocViewerModal } from "./DocViewerModal.tsx";
import { executeAction, fetchDocFiles, fetchProject, openInIde, rescanSingleProject, saveAnnotation, type DocFile } from "../apiClient.ts";

interface DetailPanelProps {
  project: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
  onRescanProject?: (id: string, fetchRemotes?: boolean) => Promise<void>;
  onGenerateScript?: (actionName: string, projectIds?: string[]) => void;
  onImproveGuidance?: (project: Project) => void;
}

export function DetailPanel({ project, onClose, onSaved, onRescanProject, onGenerateScript, onImproveGuidance }: DetailPanelProps) {
  const [copied, setCopied] = useState(false);
  const [docFiles, setDocFiles] = useState<DocFile[]>([]);
  const [openDoc, setOpenDoc] = useState<DocFile | null>(null);
  const [openingIde, setOpeningIde] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const highestSeverity = project.risk === 3 ? "critical" : project.risk === 2 ? "warn" : project.risk === 1 ? "info" : "good";

  useEffect(() => {
    setOpenDoc(null);
    setOpenError(null);
    setFetchError(null);
    setRescanError(null);
    setFlagError(null);
    setActionError(null);
    fetchDocFiles(project.id)
      .then(setDocFiles)
      .catch(() => setDocFiles([]));
  }, [project.id]);

  async function handleExecuteAction(actionName: string) {
    setActionError(null);
    setExecutingAction(actionName);
    try {
      const res = await executeAction(project.id, actionName);
      if (res.project) {
        onSaved(res.project);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setExecutingAction(null);
    }
  }

  async function handleSuppressFlag(ruleName: string) {
    setFlagError(null);
    const currentSuppressed = project.annotation.suppressedFlags ?? [];
    if (!currentSuppressed.includes(ruleName)) {
      const nextSuppressed = [...currentSuppressed, ruleName];
      try {
        const res = await saveAnnotation(project.id, { suppressedFlags: nextSuppressed });
        if (res.project) onSaved(res.project);
      } catch (error) {
        setFlagError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function handleUnsuppressFlag(ruleName: string) {
    setFlagError(null);
    const currentSuppressed = project.annotation.suppressedFlags ?? [];
    const nextSuppressed = currentSuppressed.filter((r) => r !== ruleName);
    try {
      const res = await saveAnnotation(project.id, { suppressedFlags: nextSuppressed });
      if (res.project) onSaved(res.project);
    } catch (error) {
      setFlagError(error instanceof Error ? error.message : String(error));
    }
  }

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(project.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function handleOpenInIde(ideId: string) {
    setOpenError(null);
    setOpeningIde(ideId);
    try {
      await openInIde(project.id, ideId);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningIde(null);
    }
  }

  async function handleQuickFetch() {
    setFetchError(null);
    setFetching(true);
    try {
      if (onRescanProject) {
        await onRescanProject(project.id, true);
      } else {
        const res = await fetchProject(project.id);
        if (res.project) {
          onSaved(res.project);
        }
      }
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : String(error));
    } finally {
      setFetching(false);
    }
  }

  async function handleRescan(fetchRemotes: boolean = true) {
    setRescanError(null);
    setRescanning(true);
    try {
      if (onRescanProject) {
        await onRescanProject(project.id, fetchRemotes);
      } else {
        const res = await rescanSingleProject(project.id, fetchRemotes);
        if (res.project) {
          onSaved(res.project);
        }
      }
    } catch (error) {
      setRescanError(error instanceof Error ? error.message : String(error));
    } finally {
      setRescanning(false);
    }
  }

  return (
    <aside className="flex w-[440px] shrink-0 flex-col overflow-hidden border-l border-border bg-panel shadow-2xl">
      {/* Hero Header */}
      <div className="flex items-center justify-between border-b border-border bg-panel/95 backdrop-blur-xs p-4 sticky top-0 z-20">
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-2 min-w-0">
            {project.annotation.alias ? (
              <div className="flex items-baseline gap-1.5 min-w-0 truncate" title={`Folder: ${project.name}`}>
                <h2 className="truncate text-base font-bold tracking-tight text-ink">{project.annotation.alias}</h2>
                <span className="text-xs font-mono font-normal text-muted/70 shrink-0">({project.name})</span>
              </div>
            ) : (
              <h2 className="truncate text-base font-bold tracking-tight text-ink">{project.name}</h2>
            )}
            <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${
              highestSeverity === "critical"
                ? "bg-critical shadow-[0_0_6px_rgba(248,81,73,0.8)]"
                : highestSeverity === "warn"
                ? "bg-warn shadow-[0_0_6px_rgba(210,153,34,0.8)]"
                : highestSeverity === "info"
                ? "bg-info shadow-[0_0_6px_rgba(88,166,255,0.8)]"
                : "bg-good shadow-[0_0_6px_rgba(63,185,80,0.8)]"
            }`} />
          </div>
          <div className="truncate text-xs font-mono text-muted/80 select-text mt-0.5">{project.relPath}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={copyPath}
            className="btn btn-secondary px-2.5 py-1 text-xs"
            title="Copy path to clipboard"
          >
            {copied ? "Copied" : "Copy path"}
          </button>
          <button
            onClick={onClose}
            className="btn btn-ghost px-2 py-1 text-base text-muted hover:text-ink"
            title="Close panel (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Health & Flags Card */}
        <div className="rounded-xl border border-border/80 bg-surface/50 p-4 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted">Health & Flags</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
              highestSeverity === "critical"
                ? "bg-critical/15 text-critical border-critical/30"
                : highestSeverity === "warn"
                ? "bg-warn/15 text-warn border-warn/30"
                : highestSeverity === "info"
                ? "bg-info/15 text-info border-info/30"
                : "bg-good/15 text-good border-good/30"
            }`}>
              {highestSeverity.toUpperCase()}
            </span>
          </div>

          {project.suppressed && (
            <div className="mb-2 text-[11px] text-muted bg-surface/80 p-2 rounded border border-border/50">
              Non-critical flags suppressed ({project.annotation.status}/snoozed)
            </div>
          )}

          {project.duplicateOf && project.duplicateOf.length > 0 && (
            <div className={`mb-3 rounded-lg p-2.5 text-xs border ${
              project.isDuplicateCopy
                ? "bg-warn/10 border-warn/30 text-ink"
                : "bg-surface border-border text-ink"
            }`}>
              <div className="flex items-center justify-between mb-1 font-semibold">
                <span className="flex items-center gap-1.5">
                  <span>{project.isDuplicateCopy ? "⚠️" : "📦"}</span>
                  <span>{project.isDuplicateCopy ? "Duplicate Copy" : "Primary Repository"}</span>
                </span>
                <span className="text-[10px] font-mono text-muted">
                  {project.duplicateOf.length} {project.duplicateOf.length === 1 ? "other copy" : "other copies"}
                </span>
              </div>
              <div className="text-[11px] text-muted space-y-1">
                <div>{project.isDuplicateCopy ? "Duplicate of:" : "Also checked out at:"}</div>
                <div className="font-mono text-[11px] text-ink/90 flex flex-wrap gap-1">
                  {project.duplicateOf.map((path) => (
                    <span key={path} className="px-1.5 py-0.5 rounded bg-panel border border-border">
                      {path}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {project.flags.map((flag) => {
              const canSuppress = flag.rule !== "HEALTHY" && flag.rule !== "RULE_ERROR" && flag.rule !== "PROBE_ERROR";
              return (
                <div
                  key={flag.rule}
                  className={`rounded-lg border-l-3 bg-surface p-2.5 text-xs ${
                    flag.severity === "critical"
                      ? "border-l-critical bg-critical/5 border-border/50"
                      : flag.severity === "warn"
                      ? "border-l-warn bg-warn/5 border-border/50"
                      : flag.severity === "info"
                      ? "border-l-info bg-info/5 border-border/50"
                      : "border-l-good bg-good/5 border-border/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-ink">{flag.label}</div>
                    <div className="flex items-center gap-1 shrink-0">
                      {flag.rule === "STALE_REFS" && (
                        <button
                          type="button"
                          onClick={handleQuickFetch}
                          disabled={fetching || rescanning}
                          className="btn btn-secondary px-2.5 py-1 text-xs hover:border-info/50 flex items-center gap-1"
                        >
                          {fetching ? (
                            <>
                              <span className="inline-block animate-spin">🔄</span>
                              <span>Fetching…</span>
                            </>
                          ) : (
                            <>
                              <span>⚡</span>
                              <span>Quick fetch</span>
                            </>
                          )}
                        </button>
                      )}
                      {flag.rule === "NOT_VERSIONED" && (
                        <button
                          type="button"
                          onClick={() => handleExecuteAction("init")}
                          disabled={executingAction !== null}
                          className="btn btn-secondary px-2.5 py-1 text-xs hover:border-info/50 flex items-center gap-1"
                          title="Initialize git repo, write .gitignore, and make initial commit"
                        >
                          {executingAction === "init" ? (
                            <>
                              <span className="inline-block animate-spin">🔄</span>
                              <span>Initializing…</span>
                            </>
                          ) : (
                            <>
                              <span>🌱</span>
                              <span>Git init</span>
                            </>
                          )}
                        </button>
                      )}
                      {flag.rule === "LOCAL_ONLY" && (
                        <button
                          type="button"
                          onClick={() => handleExecuteAction("publish")}
                          disabled={executingAction !== null}
                          className="btn btn-secondary px-2.5 py-1 text-xs hover:border-info/50 flex items-center gap-1"
                          title="Create private GitHub repository using gh CLI and push"
                        >
                          {executingAction === "publish" ? (
                            <>
                              <span className="inline-block animate-spin">🔄</span>
                              <span>Creating repo…</span>
                            </>
                          ) : (
                            <>
                              <span>🚀</span>
                              <span>Publish (gh)</span>
                            </>
                          )}
                        </button>
                      )}
                      {flag.rule === "NO_UPSTREAM" && (
                        <button
                          type="button"
                          onClick={() => handleExecuteAction("set-upstream")}
                          disabled={executingAction !== null}
                          className="btn btn-secondary px-2.5 py-1 text-xs hover:border-info/50 flex items-center gap-1"
                          title="Set upstream tracking branch and push to remote"
                        >
                          {executingAction === "set-upstream" ? (
                            <>
                              <span className="inline-block animate-spin">🔄</span>
                              <span>Setting upstream…</span>
                            </>
                          ) : (
                            <>
                              <span>⬆️</span>
                              <span>Set upstream</span>
                            </>
                          )}
                        </button>
                      )}
                      {canSuppress && (
                        <button
                          type="button"
                          onClick={() => handleSuppressFlag(flag.rule)}
                          className="btn btn-ghost px-2 py-0.5 text-[10px] text-muted hover:text-warn hover:bg-warn/10"
                          title={`Suppress ${flag.rule} flag for this project`}
                        >
                          🔇 Suppress
                        </button>
                      )}
                    </div>
                  </div>
                  {flag.detail && <div className="mt-0.5 text-[11px] text-muted/90 leading-relaxed">{flag.detail}</div>}
                  <div className="mt-1 text-[10px] font-mono text-muted/60">{flag.rule}</div>
                  {flag.rule === "STALE_REFS" && fetchError && (
                    <div className="mt-2 text-xs text-critical bg-critical/10 p-2 rounded border border-critical/20">
                      {fetchError}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {project.annotation.suppressedFlags && project.annotation.suppressedFlags.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted mb-2">
                Suppressed Flags ({project.annotation.suppressedFlags.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {project.annotation.suppressedFlags.map((ruleName) => (
                  <div
                    key={ruleName}
                    className="flex items-center gap-1.5 rounded-md bg-surface border border-border/60 px-2 py-1 text-xs text-muted shadow-2xs"
                  >
                    <span className="font-mono text-[11px] text-ink font-medium">{ruleName}</span>
                    <button
                      type="button"
                      onClick={() => handleUnsuppressFlag(ruleName)}
                      className="text-muted hover:text-critical font-bold text-xs leading-none p-0.5"
                      title={`Unsuppress ${ruleName}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {flagError && (
            <div className="mt-2 text-xs text-critical bg-critical/10 p-2 rounded border border-critical/20">
              {flagError}
            </div>
          )}
        </div>

        {/* Actions & Launchers Card */}
        <div className="rounded-xl border border-border/80 bg-surface/50 p-4 shadow-2xs space-y-3">
          <div>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">Open In Editor / IDE</h3>
            <div className="flex flex-wrap gap-2">
              {IDE_LAUNCHERS.map((ide) => (
                <button
                  key={ide.id}
                  onClick={() => handleOpenInIde(ide.id)}
                  disabled={openingIde !== null}
                  className="btn btn-secondary px-3 py-1.5 text-xs hover:border-info/50"
                >
                  {openingIde === ide.id ? "Launching…" : ide.label}
                </button>
              ))}
            </div>
            {openError && <div className="mt-2 text-xs text-critical bg-critical/10 p-2 rounded border border-critical/20">{openError}</div>}
          </div>

          <div className="pt-2 border-t border-border/50">
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">Agent guidance</h3>
            <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs" onClick={() => onImproveGuidance?.(project)}>
              Improve agent guidance
            </button>
            <p className="mt-1 text-[11px] text-muted">Review selected local coding-agent sessions before proposing a confirmed AGENTS.md edit.</p>
          </div>

          <div className="pt-2 border-t border-border/50">
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">Refresh / Update Status</h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleRescan(true)}
                disabled={rescanning || fetching}
                className="btn btn-secondary px-3 py-1.5 text-xs hover:border-info/50 flex items-center gap-1.5"
                title="Refresh facts, git status, and fetch remotes for this project"
              >
                {rescanning ? (
                  <>
                    <span className="inline-block animate-spin">🔄</span>
                    <span>Refreshing…</span>
                  </>
                ) : (
                  <>
                    <span>🔄</span>
                    <span>Refresh project (with fetch)</span>
                  </>
                )}
              </button>
              <button
                onClick={() => handleRescan(false)}
                disabled={rescanning || fetching}
                className="btn btn-secondary px-3 py-1.5 text-xs hover:border-info/50 flex items-center gap-1.5"
                title="Refresh local facts and git status without fetching remotes"
              >
                {rescanning ? (
                  <span>Refreshing…</span>
                ) : (
                  <>
                    <span>⚡</span>
                    <span>Refresh local only</span>
                  </>
                )}
              </button>
            </div>
            {rescanError && (
              <div className="mt-2 text-xs text-critical bg-critical/10 p-2 rounded border border-critical/20">
                {rescanError}
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-border/50">
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">Git & Remote Actions</h3>
            <div className="flex flex-wrap gap-2">
              {project.isGit !== true && (
                <button
                  onClick={() => handleExecuteAction("init")}
                  disabled={executingAction !== null}
                  className="btn btn-secondary px-3 py-1.5 text-xs hover:border-info/50 flex items-center gap-1.5"
                  title="Initialize git repo, write .gitignore, and make initial commit"
                >
                  {executingAction === "init" ? (
                    <>
                      <span className="inline-block animate-spin">🔄</span>
                      <span>Initializing…</span>
                    </>
                  ) : (
                    <>
                      <span>🌱</span>
                      <span>Git init (.gitignore & commit)</span>
                    </>
                  )}
                </button>
              )}
              {project.isGit === true && project.hasRemote === false && (
                <button
                  onClick={() => handleExecuteAction("publish")}
                  disabled={executingAction !== null}
                  className="btn btn-secondary px-3 py-1.5 text-xs hover:border-info/50 flex items-center gap-1.5"
                  title="Create private GitHub repository using gh CLI and push"
                >
                  {executingAction === "publish" ? (
                    <>
                      <span className="inline-block animate-spin">🔄</span>
                      <span>Creating repo…</span>
                    </>
                  ) : (
                    <>
                      <span>🚀</span>
                      <span>Create private GitHub repo (gh)</span>
                    </>
                  )}
                </button>
              )}
              {project.hasRemote === true && project.noUpstream === true && (
                <button
                  onClick={() => handleExecuteAction("set-upstream")}
                  disabled={executingAction !== null}
                  className="btn btn-secondary px-3 py-1.5 text-xs hover:border-info/50 flex items-center gap-1.5"
                  title="Set upstream tracking branch and push to remote"
                >
                  {executingAction === "set-upstream" ? (
                    <>
                      <span className="inline-block animate-spin">🔄</span>
                      <span>Setting upstream…</span>
                    </>
                  ) : (
                    <>
                      <span>⬆️</span>
                      <span>Set upstream & push</span>
                    </>
                  )}
                </button>
              )}
              {project.isGit === true && project.hasRemote === true && project.noUpstream !== true && (
                <span className="text-xs text-muted/70 font-mono italic py-1">Git remote and upstream are configured</span>
              )}
            </div>
            {actionError && (
              <div className="mt-2.5 rounded border border-critical/30 bg-critical/10 p-2.5 text-xs text-critical">
                <div className="font-semibold mb-1 flex items-center justify-between">
                  <span>Execution Output / Log</span>
                  <button
                    type="button"
                    onClick={() => setActionError(null)}
                    className="text-[10px] text-muted hover:text-ink"
                  >
                    Dismiss
                  </button>
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-critical/90 select-text">
                  {actionError}
                </pre>
              </div>
            )}
          </div>

          {docFiles.length > 0 && (
            <div className="pt-2 border-t border-border/50">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">Documentation</h3>
              <div className="flex flex-wrap gap-1.5">
                {docFiles.map((doc) => (
                  <button
                    key={doc.file}
                    onClick={() => setOpenDoc(doc)}
                    className="btn btn-chip px-2.5 py-1 text-xs"
                  >
                    📄 {doc.file}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Agent Skills Card */}
        {project.skills && project.skills.length > 0 && (
          <div className="rounded-xl border border-border/80 bg-surface/50 p-4 shadow-2xs">
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-2">
                <span>Agent Skills</span>
                <span className="rounded-full bg-accent/15 text-accent border border-accent/30 px-1.5 py-0.2 text-[9px] font-mono">
                  {project.skills.length}
                </span>
              </h3>
            </div>
            <div className="space-y-2">
              {project.skills.map((skill) => (
                <div
                  key={skill.name}
                  className="rounded-lg border border-border/60 bg-panel/60 p-2.5 transition-colors hover:border-accent/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-ink">{skill.name}</span>
                        <span className="text-[10px] font-mono text-muted/70 truncate" title={skill.relPath}>
                          {skill.relPath}
                        </span>
                      </div>
                      {skill.description && (
                        <p className="mt-1 text-xs text-muted leading-relaxed line-clamp-2">{skill.description}</p>
                      )}
                    </div>
                    {skill.docFile && (
                      <button
                        onClick={() => setOpenDoc({ file: skill.docFile! })}
                        className="btn btn-ghost shrink-0 px-2 py-1 text-[11px] text-accent hover:bg-accent/10 border border-accent/30 hover:border-accent/50"
                        title={`View ${skill.docFile}`}
                      >
                        View 📄
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Annotation Control Card */}
        <div className="rounded-xl border border-border/80 bg-surface/50 p-4 shadow-2xs">
          <AnnotationEditor key={project.id} project={project} onSaved={onSaved} />
        </div>

        {/* Facts & Telemetry List */}
        <FactList project={project} />

        {/* Raw Facts Inspector */}
        <div className="rounded-xl border border-border/80 bg-surface/30 p-3">
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-muted/80 group-hover:text-ink select-none flex items-center justify-between">
              <span>Raw Facts JSON</span>
              <span className="text-[10px] text-muted font-mono">Expand ▾</span>
            </summary>
            <pre className="mt-2.5 max-h-60 overflow-auto rounded-md bg-surface p-2.5 text-[10px] font-mono text-muted/90 border border-border/50">
              {JSON.stringify(project, null, 2)}
            </pre>
          </details>
        </div>
      </div>

      {openDoc && (
        <DocViewerModal
          projectId={project.id}
          projectName={project.annotation.alias || project.name}
          doc={openDoc}
          onClose={() => setOpenDoc(null)}
        />
      )}
    </aside>
  );
}
