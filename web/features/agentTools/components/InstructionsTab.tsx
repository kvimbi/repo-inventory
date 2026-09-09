import type { GlobalResource, ToolCapabilityResult } from "../../../../core/types.ts";
import { AgentFileLauncher } from "./AgentFileLauncher.tsx";

interface InstructionsTabProps {
  instructions: ToolCapabilityResult<GlobalResource>;
  onPreview: (ref: string, title: string) => void;
}

export function InstructionsTab({ instructions, onPreview }: InstructionsTabProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {instructions.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="max-w-md rounded-xl border border-border bg-panel p-6">
              <svg
                className="mx-auto h-8 w-8 text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <h4 className="mt-3 text-sm font-semibold text-ink">No instruction documents found</h4>
              <p className="mt-1 text-xs text-muted">
                Create user-level instruction files (such as AGENTS.md, instructions.md, or CLAUDE.md) in the tool root directory.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {instructions.items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border bg-panel p-4 hover:border-info/40 transition-colors shadow-xs"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-info">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-ink truncate">{item.name}</h4>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          item.origin === "user"
                            ? "border-good/30 bg-good/10 text-good"
                            : "border-info/30 bg-info/10 text-info"
                        }`}
                      >
                        {item.origin}
                      </span>
                    </div>
                    {item.description && (
                      <p className="mt-1 text-xs text-muted line-clamp-1">{item.description}</p>
                    )}
                    <p className="mt-1 font-mono text-[11px] text-muted truncate" title={item.path}>
                      {item.path}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => onPreview(item.id, item.name)}
                    className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-hover hover:border-info/50 transition-colors cursor-pointer"
                  >
                    Preview
                  </button>
                  <AgentFileLauncher refId={item.id} compact />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
