import { useEffect, useState } from "react";
import { fetchDocContent, type DocFile } from "../apiClient.ts";
import { renderMarkdown } from "../lib/markdown.ts";

interface DocViewerModalProps {
  projectId: string;
  projectName: string;
  doc: DocFile;
  onClose: () => void;
}

export function DocViewerModal({ projectId, projectName, doc, onClose }: DocViewerModalProps) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; content: string; isMarkdown: boolean; truncated: boolean }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchDocContent(projectId, doc.file)
      .then((result) => {
        if (cancelled) return;
        setState({
          status: "ready",
          content: result.content,
          isMarkdown: result.isMarkdown,
          truncated: result.truncated,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, doc.file]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
      onClick={handleBackdropClick}
    >
      <div className="flex max-h-full w-[760px] flex-col rounded border border-border bg-panel">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="text-sm font-semibold">{doc.file}</h2>
            <p className="text-xs text-muted">{projectName}</p>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost px-2 py-1 text-base text-muted hover:text-ink"
            title="Close modal (Esc)"
          >
            ✕
          </button>
        </div>

        {state.status === "ready" && state.truncated && (
          <div className="border-b border-warn bg-warn/10 p-3 text-xs text-warn">
            File is large — showing the first part only.
          </div>
        )}

        <div className="flex-1 overflow-auto p-4">
          {state.status === "loading" && <div className="text-xs text-muted">Loading…</div>}
          {state.status === "error" && <div className="text-xs text-critical">{state.message}</div>}
          {state.status === "ready" && (
            state.isMarkdown ? (
              <div
                className="prose-doc text-sm"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(state.content) }}
              />
            ) : (
              <pre className="whitespace-pre-wrap text-xs leading-relaxed">{state.content}</pre>
            )
          )}
        </div>
      </div>
    </div>
  );
}
