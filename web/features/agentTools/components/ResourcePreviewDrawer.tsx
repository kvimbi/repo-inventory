import { useEffect, useState } from "react";
import type { AgentResourcePreview } from "../../../../core/types.ts";
import { readAgentResource } from "../../../apiClient.ts";
import { renderMarkdown } from "../../../lib/markdown.ts";
import { AgentFileLauncher } from "./AgentFileLauncher.tsx";

interface ResourcePreviewDrawerProps {
  refId: string | null;
  title?: string;
  onClose: () => void;
}

export function ResourcePreviewDrawer({
  refId,
  title,
  onClose,
}: ResourcePreviewDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AgentResourcePreview | null>(null);

  useEffect(() => {
    if (!refId) {
      setPreview(null);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    readAgentResource(refId)
      .then((res) => {
        if (active) {
          setPreview(res);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [refId]);

  useEffect(() => {
    if (!refId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [refId, onClose]);

  if (!refId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity">
      {/* Click outside backdrop to close */}
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 flex h-full w-full max-w-[64rem] flex-col border-l border-border bg-surface shadow-2xl lg:w-[80vw]">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink">
              {title || preview?.name || "Resource Preview"}
            </h3>
            {preview && (
              <span className="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-muted">
                {(preview.totalBytes / 1024).toFixed(1)} KB
              </span>
            )}
            {preview?.isMarkdown && (
              <span className="shrink-0 rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-[10px] text-info font-medium">
                Markdown
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-ink transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Truncation Notice */}
        {preview?.truncated && (
          <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
            <span>
              Preview truncated at 256 KB bounded limit. Total file size: {(preview.totalBytes / 1024).toFixed(1)} KB.
            </span>
          </div>
        )}

        {/* Drawer Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-64 items-center justify-center text-xs text-muted">
              <div className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin text-info"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
                </svg>
                <span>Loading preview…</span>
              </div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <div className="rounded-lg border border-critical/30 bg-critical/10 p-4 text-xs text-critical">
                <p className="font-medium">Failed to read resource preview</p>
                <p className="mt-1 text-[11px] opacity-90">{error}</p>
              </div>
            </div>
          ) : preview ? (
            preview.isMarkdown ? (
              <div
                className="prose-doc text-sm"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(preview.content) }}
              />
            ) : (
              <pre className="rounded-lg border border-border bg-panel p-4 font-mono text-xs text-ink overflow-x-auto whitespace-pre leading-normal">
                <code>{preview.content}</code>
              </pre>
            )
          ) : null}
        </div>
        {preview && <div className="border-t border-border p-4"><AgentFileLauncher refId={preview.id} /></div>}
      </div>
    </div>
  );
}
