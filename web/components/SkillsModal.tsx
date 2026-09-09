import { useState, useEffect, useMemo } from "react";
import type { Project, AgentSkill } from "../../core/types.ts";
import { DocViewerModal } from "./DocViewerModal.tsx";
import type { DocFile } from "../apiClient.ts";

interface AggregatedSkill extends AgentSkill {
  projectId: string;
  projectName: string;
  projectRelPath: string;
  projectAlias?: string | null;
}

interface SkillsModalProps {
  projects: Project[];
  onClose: () => void;
  onSelectProject: (id: string) => void;
}

export function SkillsModal({ projects, onClose, onSelectProject }: SkillsModalProps) {
  const [query, setQuery] = useState("");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<{
    projectId: string;
    projectName: string;
    doc: DocFile;
  } | null>(null);

  // Close on Escape unless sub-modal is open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !viewingDoc) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, viewingDoc]);

  // Aggregate all skills
  const allSkills = useMemo<AggregatedSkill[]>(() => {
    const list: AggregatedSkill[] = [];
    for (const p of projects) {
      if (!p.skills) continue;
      for (const s of p.skills) {
        list.push({
          ...s,
          projectId: p.id,
          projectName: p.name,
          projectRelPath: p.relPath,
          projectAlias: p.annotation.alias,
        });
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  // Filter skills
  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allSkills;
    return allSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q)) ||
        s.projectName.toLowerCase().includes(q) ||
        s.projectRelPath.toLowerCase().includes(q) ||
        (s.projectAlias && s.projectAlias.toLowerCase().includes(q)),
    );
  }, [allSkills, query]);

  const handleCopyPath = (relPath: string) => {
    navigator.clipboard.writeText(relPath);
    setCopiedPath(relPath);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  const handleSelectHostProject = (projectId: string) => {
    onSelectProject(projectId);
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-xs"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="flex h-[80vh] w-[900px] flex-col rounded-xl border border-border bg-panel shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-surface/80 px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent font-mono text-sm">
                ⚡
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-tight text-ink">Agent Skills Catalog</h2>
                  <span className="rounded-full bg-accent/15 border border-accent/30 px-2 py-0.5 text-[10px] font-mono font-medium text-accent">
                    {allSkills.length} skills across {new Set(allSkills.map((s) => s.projectId)).size} repos
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Agentic workflows and reusable instructions discovered across your projects
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="btn btn-ghost px-2 py-1 text-base text-muted hover:text-ink"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>

          {/* Search bar */}
          <div className="border-b border-border bg-surface/40 p-4">
            <div className="relative">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search skills by name, description, capability, or repository…"
                className="input-control w-full px-3.5 py-2 text-xs placeholder:text-muted/60"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-ink"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Skill List */}
          <div className="flex-1 overflow-auto p-5 space-y-3">
            {filteredSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted">
                <span className="text-2xl mb-2">🔍</span>
                <p className="text-xs">No agent skills found matching "{query}"</p>
              </div>
            ) : (
              filteredSkills.map((s) => (
                <div
                  key={`${s.projectId}:${s.name}`}
                  className="rounded-xl border border-border/70 bg-surface/50 p-4 transition-all hover:border-accent/50 hover:bg-surface/80 shadow-2xs"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-mono text-sm font-semibold text-ink">{s.name}</span>
                        <button
                          onClick={() => handleSelectHostProject(s.projectId)}
                          className="inline-flex items-center gap-1 rounded bg-info/10 hover:bg-info/20 border border-info/30 px-2 py-0.5 text-[11px] font-medium text-info transition-colors"
                          title={`Navigate to repository ${s.projectName}`}
                        >
                          📦 {s.projectAlias ?? s.projectName}
                        </button>
                        <span className="font-mono text-[10px] text-muted/80">{s.projectRelPath}</span>
                      </div>

                      {s.description ? (
                        <p className="mt-2 text-xs text-ink/85 leading-relaxed">{s.description}</p>
                      ) : (
                        <p className="mt-2 text-xs text-muted/60 italic">No description provided</p>
                      )}

                      <div className="mt-3 flex items-center gap-2 text-[11px] font-mono text-muted/70">
                        <span>{s.relPath}</span>
                        <button
                          onClick={() => handleCopyPath(s.relPath)}
                          className="hover:text-ink transition-colors"
                          title="Copy relative path"
                        >
                          {copiedPath === s.relPath ? "✓ copied" : "📋"}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {s.docFile && (
                        <button
                          onClick={() =>
                            setViewingDoc({
                              projectId: s.projectId,
                              projectName: s.projectName,
                              doc: { file: s.docFile! },
                            })
                          }
                          className="btn btn-secondary px-3 py-1.5 text-xs text-accent hover:border-accent/50"
                          title={`Preview ${s.docFile}`}
                        >
                          View Skill 📄
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border bg-surface/80 px-6 py-3 text-xs text-muted">
            <span>
              Showing <strong className="text-ink">{filteredSkills.length}</strong> of {allSkills.length} skills
            </span>
            <span className="font-mono text-[11px] text-muted/70">
              Discovered from .agents/skills & .claude/skills
            </span>
          </div>
        </div>
      </div>

      {viewingDoc && (
        <DocViewerModal
          projectId={viewingDoc.projectId}
          projectName={viewingDoc.projectName}
          doc={viewingDoc.doc}
          onClose={() => setViewingDoc(null)}
        />
      )}
    </>
  );
}
