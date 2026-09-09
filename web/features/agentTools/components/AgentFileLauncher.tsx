import { useState } from "react";
import { IDE_LAUNCHERS } from "../../../../core/ides.ts";
import { openAgentConfiguration } from "../../../apiClient.ts";

interface AgentFileLauncherProps {
  refId: string;
  label?: string;
  compact?: boolean;
}

export function AgentFileLauncher({ refId, label = "Open In Editor / IDE", compact = false }: AgentFileLauncherProps) {
  const [opening, setOpening] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function launch(ide: string, ideLabel: string) {
    setOpening(ide);
    setMessage(null);
    try {
      const result = await openAgentConfiguration({ ref: refId, action: "editor", ide });
      setMessage(result.ok
        ? { type: "success", text: `Opened in ${ideLabel}.` }
        : { type: "error", text: result.message ?? `Failed to open in ${ideLabel}.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "rounded-lg border border-border bg-panel p-3"}>
      <p className={`${compact ? "" : "mb-2"} text-[10px] font-bold uppercase tracking-wider text-muted`}>{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {IDE_LAUNCHERS.map((ide) => (
          <button
            key={ide.id}
            type="button"
            disabled={opening !== null}
            onClick={() => void launch(ide.id, ide.label)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-ink hover:border-info/50 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {opening === ide.id ? "Opening…" : ide.label}
          </button>
        ))}
      </div>
      {message && (
        <p className={`${compact ? "basis-full" : "mt-2"} text-[11px] ${message.type === "success" ? "text-good" : "text-critical"}`} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
