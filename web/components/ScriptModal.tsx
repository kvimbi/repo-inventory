import { useEffect, useState } from "react";

interface ActionMeta {
  name: string;
  label: string;
  description: string;
}

interface ScriptResult {
  script: string;
  included: string[];
  skipped: string[];
}

interface ScriptModalProps {
  action: ActionMeta;
  result: ScriptResult;
  onClose: () => void;
}

export function ScriptModal({ action, result, onClose }: ScriptModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(result.script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  function downloadScript() {
    const blob = new Blob([result.script], { type: "text/x-shellscript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.href = url;
    a.download = `repo-inventory-${action.name}-${date}.sh`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
      onClick={handleBackdropClick}
    >
      <div className="flex max-h-full w-[840px] flex-col rounded border border-border bg-panel">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-semibold">{action.label}</h2>
          <p className="text-xs text-muted">{action.description}</p>
        </div>

        <div className="border-b border-warn bg-warn/10 p-3 text-xs text-warn">
          Nothing has been executed. Read every line, then run it yourself.
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="mb-2 text-xs">
            <span className="font-medium">{result.included.length}</span> projects included
            {result.skipped.length > 0 && (
              <span className="text-muted">
                {" "}
                ({result.skipped.length} skipped)
              </span>
            )}
          </div>

          {result.skipped.length > 0 && (
            <div className="mb-4">
              <div className="mb-1 text-[10px] uppercase text-muted">skipped (not eligible for this action)</div>
              <div className="text-xs text-muted">
                {result.skipped.join(", ")}
              </div>
            </div>
          )}

          <pre className="max-h-96 overflow-auto rounded bg-surface p-3 text-[11px] leading-relaxed">
            {result.script}
          </pre>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button
            onClick={copyToClipboard}
            className="btn btn-secondary px-3 py-1.5 text-xs"
          >
            {copied ? "Copied" : "Copy script"}
          </button>
          <button
            onClick={downloadScript}
            className="btn btn-secondary px-3 py-1.5 text-xs"
          >
            Download .sh
          </button>
          <button
            onClick={onClose}
            className="btn btn-primary px-3 py-1.5 text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
