import type { Filters, Facets } from "../lib/filter.ts";
import { EMPTY_FILTERS } from "../lib/filter.ts";
import { severityColor } from "../lib/format.ts";
import type { FlagSeverity, ProjectStatus } from "../../core/types.ts";

interface FilterBarProps {
  filters: Filters;
  facets: Facets;
  visibleCount: number;
  totalCount: number;
  onChange: (filters: Filters) => void;
}

const STATUSES: ProjectStatus[] = ["unknown", "active", "stale", "obsolete", "archived"];

export function FilterBar({ filters, facets, visibleCount, totalCount, onChange }: FilterBarProps) {
  const isFiltered =
    filters.query !== EMPTY_FILTERS.query ||
    filters.groups.length > 0 ||
    filters.statuses.length > 0 ||
    filters.severities.length > 0 ||
    filters.stacks.length > 0 ||
    filters.rules.length > 0 ||
    filters.projectTypes.length > 0 ||
    filters.todoOnly !== EMPTY_FILTERS.todoOnly ||
    filters.hasSkills !== EMPTY_FILTERS.hasSkills ||
    filters.hideResolved !== EMPTY_FILTERS.hideResolved;

  const update = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-panel px-5 py-2.5">
      <div className="relative">
        <input
          type="text"
          value={filters.query}
          onChange={(e) => update({ query: e.target.value })}
          placeholder="Filter by name, path or stack…"
          className="input-control w-72 px-3 py-1.5 text-xs placeholder:text-muted/60"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => update({ query: "" })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>

      <select
        value={filters.projectTypes[0] ?? ""}
        onChange={(e) => update({ projectTypes: e.target.value ? [e.target.value as "standalone" | "monorepo-root" | "sub-project"] : [] })}
        className="select-control px-2.5 py-1.5 text-xs font-medium"
      >
        <option value="">all types</option>
        <option value="standalone">standalone repos</option>
        <option value="monorepo-root">monorepo roots</option>
        <option value="sub-project">sub-projects</option>
      </select>

      <select
        value={filters.groups[0] ?? ""}
        onChange={(e) => update({ groups: e.target.value ? [e.target.value] : [] })}
        className="select-control px-2.5 py-1.5 text-xs"
      >
        <option value="">all groups</option>
        {facets.groups.map((g) => (
          <option key={g.value} value={g.value}>
            {g.value} ({g.count})
          </option>
        ))}
      </select>

      <select
        value={filters.statuses.length === 1 ? (filters.statuses[0] ?? "") : ""}
        onChange={(e) => update({ statuses: e.target.value ? [e.target.value as ProjectStatus] : [] })}
        className="select-control px-2.5 py-1.5 text-xs"
      >
        <option value="">
          {filters.statuses.length > 1 ? `${filters.statuses.length} statuses selected` : "all statuses"}
        </option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        value={filters.stacks[0] ?? ""}
        onChange={(e) => update({ stacks: e.target.value ? [e.target.value] : [] })}
        className="select-control px-2.5 py-1.5 text-xs"
      >
        <option value="">all stacks</option>
        {facets.stacks.map((s) => (
          <option key={s.value} value={s.value}>
            {s.value} ({s.count})
          </option>
        ))}
      </select>

      <select
        value={filters.rules[0] ?? ""}
        onChange={(e) => update({ rules: e.target.value ? [e.target.value] : [] })}
        className="select-control px-2.5 py-1.5 text-xs"
      >
        <option value="">all flags</option>
        {facets.rules.map((r) => (
          <option key={r.value} value={r.value} className={severityColor(r.severity)}>
            {r.value} ({r.count})
          </option>
        ))}
      </select>

      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted hover:text-ink select-none">
        <input
          type="checkbox"
          checked={filters.todoOnly}
          onChange={(e) => update({ todoOnly: e.target.checked })}
          className="rounded border-border bg-surface text-warn focus:ring-1 focus:ring-warn"
        />
        todo only
      </label>

      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted hover:text-ink select-none">
        <input
          type="checkbox"
          checked={filters.hasSkills}
          onChange={(e) => update({ hasSkills: e.target.checked })}
          className="rounded border-border bg-surface text-accent focus:ring-1 focus:ring-accent"
        />
        has skills ({facets.skillsCount})
      </label>

      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted hover:text-ink select-none">
        <input
          type="checkbox"
          checked={filters.hideResolved}
          onChange={(e) => update({ hideResolved: e.target.checked })}
          className="rounded border-border bg-surface text-info focus:ring-1 focus:ring-info"
        />
        hide obsolete/archived
      </label>

      {isFiltered && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="btn btn-ghost px-2 py-1 text-xs text-info hover:bg-info/10"
        >
          Reset filters
        </button>
      )}

      <span className="ml-auto rounded-full bg-surface border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted">
        <strong className="text-ink">{visibleCount}</strong> of {totalCount} projects
      </span>
    </div>
  );
}
