import { isElectron } from "../electronBridge.ts";
import { Logo } from "./Logo.tsx";
import type { ScanProgress } from "../../core/types.ts";

interface LoadingScreenProps {
  progress: ScanProgress | null;
  error?: string | null;
  onRetry?: () => void;
  showHeader?: boolean;
}

export function LoadingScreen({ progress, error, onRetry, showHeader = false }: LoadingScreenProps) {
  const hasTotal = progress?.total !== undefined && progress.total > 0;
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const percent = hasTotal ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : null;

  const phaseTitle = (() => {
    if (error) return "Initialization Error";
    if (!progress) return "Starting repo-inventory…";
    switch (progress.phase) {
      case "discovering":
        return "Discovering repositories…";
      case "probing":
        return "Analyzing repositories…";
      case "evaluating":
        return "Evaluating rules & flags…";
      case "refreshing":
        return "Quick refreshing active projects…";
      case "ready":
        return "Ready!";
      default:
        return "Scanning workspace…";
    }
  })();

  const phaseSubtitle = (() => {
    if (error) return error;
    if (progress?.message) return progress.message;
    switch (progress?.phase) {
      case "discovering":
        return "Searching directory tree for git roots, packages, and manifests";
      case "probing":
        return "Inspecting branches, remotes, git sync status, and footprints";
      case "evaluating":
        return "Checking data-loss risks, stale checkouts, and project hygiene";
      case "refreshing":
        return "Checking current state of active and unarchived services";
      default:
        return "Preparing project scanner…";
    }
  })();

  return (
    <div className="flex h-full flex-col bg-surface text-ink select-none">
      {/* Title bar clearance for macOS traffic lights in Electron */}
      {showHeader && (
        <header
          className={`flex items-center gap-3 border-b border-border bg-panel px-5 py-3 ${
            isElectron() ? "app-drag pl-20" : ""
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Logo size={22} />
            <h1 className="text-xs font-semibold tracking-wide text-ink">repo-inventory</h1>
          </div>
          <div className="ml-auto text-xs text-muted">
            {hasTotal ? `${done} of ${total} projects` : "Starting up…"}
          </div>
        </header>
      )}

      {/* Main heroic progress area */}
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-xl border border-border bg-panel p-8 shadow-2xl">
          <div className="flex flex-col items-center text-center">
            {/* Ambient glowing brand mark */}
            <div className="relative mb-6 flex items-center justify-center">
              <div className="absolute -inset-2 rounded-2xl bg-info/20 blur-xl transition-all duration-500" />
              <Logo size={56} className="relative transition-transform duration-300 hover:scale-105" />
            </div>

            {/* Status headlines */}
            <h2 className="text-base font-semibold tracking-tight text-ink">{phaseTitle}</h2>
            <p className="mt-1.5 min-h-[2.5rem] max-w-sm text-xs leading-relaxed text-muted line-clamp-2">
              {phaseSubtitle}
            </p>

            {/* Error view */}
            {error ? (
              <div className="mt-6 flex flex-col items-center gap-3 w-full">
                <div className="w-full rounded-md border border-critical/40 bg-critical/10 p-3 text-xs text-critical text-left font-mono break-all">
                  {error}
                </div>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="btn btn-primary px-4 py-1.5 text-xs mt-2"
                  >
                    Retry scan
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-6 w-full flex flex-col gap-3">
                {/* Progress bar container */}
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface border border-border-subtle">
                  {hasTotal && percent !== null ? (
                    <div
                      className="h-full bg-gradient-to-r from-info to-good transition-all duration-200 ease-out"
                      style={{ width: `${percent}%` }}
                    />
                  ) : (
                    <div className="h-full w-1/3 bg-info animate-indeterminate rounded-full" />
                  )}
                </div>

                {/* Progress metadata counters */}
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>
                    {hasTotal ? (
                      <>
                        <span className="font-mono text-ink font-medium">{done}</span>
                        <span className="text-muted"> / {total} projects</span>
                      </>
                    ) : (
                      "Initializing…"
                    )}
                  </span>
                  {percent !== null && (
                    <span className="font-mono text-xs text-info font-medium">{percent}%</span>
                  )}
                </div>

                {/* Active project pill indicator */}
                {progress?.current && (
                  <div className="mt-2 flex items-center gap-2 rounded-md border border-border-subtle bg-surface/70 px-3 py-1.5 text-left text-xs">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-info" />
                    </span>
                    <span className="truncate font-mono text-ink font-normal" title={progress.current}>
                      {progress.current}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
