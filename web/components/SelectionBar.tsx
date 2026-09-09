import type { Project } from "../../core/types.ts";

interface ActionMeta {
  name: string;
  label: string;
  description: string;
}

interface SelectionBarProps {
  checkedProjects: Project[];
  actions: ActionMeta[];
  onClear: () => void;
  onGenerate: (actionName: string) => void;
  busy: boolean;
}

export function SelectionBar({ checkedProjects, actions, onClear, onGenerate, busy }: SelectionBarProps) {
  if (checkedProjects.length === 0) return null;

  const names = checkedProjects.slice(0, 3).map((p) => p.annotation?.alias || p.name);
  const more = checkedProjects.length > 3 ? `+${checkedProjects.length - 3} more` : "";

  return (
    <div className="sticky bottom-0 z-20 flex items-center justify-between gap-4 border-t border-border bg-panel/95 backdrop-blur-md px-5 py-3 shadow-lg">
      <div className="flex items-center gap-3 min-w-0">
        <span className="inline-flex items-center justify-center rounded-full bg-info/20 px-2.5 py-0.5 text-xs font-semibold text-info border border-info/30">
          {checkedProjects.length} selected
        </span>
        <div className="truncate text-xs text-muted/80 font-mono">
          {names.join(", ")} {more}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {actions.map((a) => (
          <button
            key={a.name}
            onClick={() => onGenerate(a.name)}
            disabled={busy}
            title={a.description}
            className="btn btn-primary px-3 py-1.5 text-xs shadow-sm"
          >
            {a.label}
          </button>
        ))}
        <button
          onClick={onClear}
          disabled={busy}
          className="btn btn-ghost px-3 py-1.5 text-xs text-muted hover:text-ink"
        >
          Clear selection
        </button>
      </div>
    </div>
  );
}
