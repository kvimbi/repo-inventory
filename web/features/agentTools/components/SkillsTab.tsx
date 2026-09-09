import { useState } from "react";
import type { GlobalResource, ToolCapabilityResult } from "../../../../core/types.ts";

interface SkillsTabProps {
  skills: ToolCapabilityResult<GlobalResource>;
  onPreview: (ref: string, title: string) => void;
}

export function SkillsTab({ skills, onPreview }: SkillsTabProps) {
  const [search, setSearch] = useState("");

  const filteredItems = skills.items.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      (item.description && item.description.toLowerCase().includes(q)) ||
      item.path.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search & Stats Bar */}
      <div className="flex items-center justify-between border-b border-border bg-panel px-6 py-3">
        <div className="flex items-center gap-3 flex-1 max-w-sm">
          <div className="relative flex items-center w-full">
            <svg
              className="absolute left-2.5 h-3.5 w-3.5 text-muted pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills…"
              className="w-full rounded-md border border-border bg-surface py-1 pl-8 pr-3 text-xs text-ink placeholder:text-muted focus:border-info focus:outline-none transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 text-muted hover:text-ink cursor-pointer"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted">
          <span>
            {filteredItems.length} of {skills.items.length} skills
          </span>
          {skills.truncated && (
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
              Capped at 100
            </span>
          )}
        </div>
      </div>

      {/* Table / List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {skills.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="max-w-md rounded-xl border border-border bg-panel p-6">
              <svg
                className="mx-auto h-8 w-8 text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              <h4 className="mt-3 text-sm font-semibold text-ink">No skills discovered</h4>
              <p className="mt-1 text-xs text-muted">
                No global skills were found in configured directories for this tool.
              </p>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted">
            No skills match "{search}".
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-panel">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-surface/50 text-[11px] font-medium text-muted uppercase tracking-wider">
                  <th className="py-2.5 px-4">Skill Name</th>
                  <th className="py-2.5 px-4">Description</th>
                  <th className="py-2.5 px-4">Origin</th>
                  <th className="py-2.5 px-4">Activation</th>
                  <th className="py-2.5 px-4">Source Path</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-surface/60 transition-colors">
                    <td className="py-3 px-4 font-semibold text-ink whitespace-nowrap">
                      {item.name}
                    </td>
                    <td className="py-3 px-4 text-muted max-w-md">
                      {item.description ? (
                        <p className="line-clamp-2 leading-relaxed">{item.description}</p>
                      ) : (
                        <span className="italic text-muted/60">No description provided</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          item.origin === "user"
                            ? "border-good/30 bg-good/10 text-good"
                            : "border-info/30 bg-info/10 text-info"
                        }`}
                      >
                        {item.origin}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          item.activation === "enabled"
                            ? "border-good/30 bg-good/10 text-good"
                            : item.activation === "disabled"
                            ? "border-critical/30 bg-critical/10 text-critical"
                            : "border-border bg-surface text-muted"
                        }`}
                      >
                        {item.activation}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-muted max-w-xs truncate" title={item.path}>
                      {item.path}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onPreview(item.id, item.name)}
                        className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-hover hover:border-info/50 transition-colors cursor-pointer"
                      >
                        Preview
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
