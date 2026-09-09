import { useState } from "react";
import type { ConfigurationReference } from "../../../../core/types.ts";
import { openAgentConfiguration } from "../../../apiClient.ts";
import { AgentFileLauncher } from "./AgentFileLauncher.tsx";

interface ConfigTabProps {
  configurations: ConfigurationReference[];
}

export function ConfigTab({ configurations }: ConfigTabProps) {
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleReveal = async (config: ConfigurationReference) => {
    setRevealingId(config.id);
    setStatusMessage(null);
    try {
      const res = await openAgentConfiguration({ ref: config.id, action: "reveal" });
      if (res.ok) {
        setStatusMessage({
          type: "success",
          text: `Revealed ${config.label} in folder.`,
        });
      } else {
        setStatusMessage({
          type: "error",
          text: res.message || `Failed to reveal ${config.label}`,
        });
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRevealingId(null);
    }
  };

  const handleCopyPath = (config: ConfigurationReference) => {
    void navigator.clipboard.writeText(config.path).then(() => {
      setCopiedId(config.id);
      setTimeout(() => {
        setCopiedId(null);
      }, 2000);
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Feedback Banner */}
      {statusMessage && (
        <div
          className={`flex items-center justify-between border-b px-6 py-2 text-xs ${
            statusMessage.type === "success"
              ? "border-good/30 bg-good/10 text-good"
              : "border-critical/30 bg-critical/10 text-critical"
          }`}
        >
          <span>{statusMessage.text}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-[11px] underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {configurations.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="max-w-md rounded-xl border border-border bg-panel p-6">
              <svg
                className="mx-auto h-8 w-8 text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              <h4 className="mt-3 text-sm font-semibold text-ink">No configuration files discovered</h4>
              <p className="mt-1 text-xs text-muted">
                No verified configuration files were detected for this tool.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {configurations.map((cfg) => (
              <div
                key={cfg.id}
                className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-xl border border-border bg-panel p-4 hover:border-info/40 transition-colors shadow-xs"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-accent">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-ink truncate">{cfg.label}</h4>
                      {cfg.exists ? (
                        <span className="rounded-full border border-good/30 bg-good/10 px-2 py-0.5 text-[10px] text-good font-medium">
                          Found
                        </span>
                      ) : (
                        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-muted font-medium">
                          Missing
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-muted truncate" title={cfg.path}>
                      {cfg.path}
                    </p>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
                      <span>
                        Size: {cfg.sizeBytes !== undefined ? `${(cfg.sizeBytes / 1024).toFixed(1)} KB` : "—"}
                      </span>
                      <span>•</span>
                      <span>
                        Modified: {cfg.lastModifiedAt ? new Date(cfg.lastModifiedAt).toLocaleString() : "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0 self-end lg:self-center">
                  <button
                    type="button"
                    onClick={() => handleCopyPath(cfg)}
                    className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-hover hover:border-info/50 transition-colors cursor-pointer"
                    title="Copy full path to clipboard"
                  >
                    {copiedId === cfg.id ? (
                      <span className="text-good font-semibold">Copied!</span>
                    ) : (
                      "Copy path"
                    )}
                  </button>
                  {cfg.exists && <AgentFileLauncher refId={cfg.id} compact />}
                  <button
                    type="button"
                    disabled={!cfg.exists || revealingId === cfg.id}
                    onClick={() => handleReveal(cfg)}
                    className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-hover hover:border-info/50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Reveal configuration file in macOS Finder"
                  >
                    {revealingId === cfg.id ? "Revealing…" : "Reveal in folder"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
