# TASK 12 — Web: summary, filters, table

**Goal:** replace the placeholder body from TASK 11 with the real overview — a
summary bar, a filter bar, and a dense sortable project table.

**Files you create:**

- `web/components/SummaryBar.tsx`
- `web/components/FilterBar.tsx`
- `web/components/ProjectTable.tsx`
- `web/components/ProjectRow.tsx`
- `web/lib/filter.ts`

**File you modify:** `web/App.tsx` — only to hold filter state and render the new
components in place of the placeholder.

**Files you must not touch:** everything else.

---

## `web/lib/filter.ts` — pure logic, no React

```ts
import type { Project, FlagSeverity, ProjectStatus } from "../../core/types.ts";

export interface Filters {
  /** Matches name, relPath, stack and framework entries. Case-insensitive. */
  query: string;
  groups: string[];          // empty = all
  statuses: ProjectStatus[]; // empty = all
  severities: FlagSeverity[];// empty = all; matches a project's highest severity
  stacks: string[];          // empty = all; project matches if it has ANY of these
  rules: string[];           // empty = all; project matches if it has ANY of these flags
  /** Hide projects marked obsolete or archived. Default true. */
  hideResolved: boolean;
}

export type SortKey = "risk" | "name" | "group" | "lastCommit" | "size" | "commits90d";

export const EMPTY_FILTERS: Filters;

export function filterProjects(projects: Project[], filters: Filters): Project[];
export function sortProjects(projects: Project[], key: SortKey, descending: boolean): Project[];

export interface Facets {
  groups: Array<{ value: string; count: number }>;
  stacks: Array<{ value: string; count: number }>;
  rules: Array<{ value: string; count: number; severity: FlagSeverity }>;
}

/** Counts available filter values from the full project list, so the UI never shows a dead option. */
export function computeFacets(projects: Project[]): Facets;
```

Rules for the implementation:

- Filters combine with **AND** across categories, **OR** within a category. That
  is what people expect from a facet list.
- `hideResolved` is applied first and independently.
- `sortProjects` must be **stable** and must return a new array — never mutate the
  input. Nulls sort last regardless of direction: a project with no commits should
  not top a "most recent commit" list.
- `severities` matches the severity of a project's **highest** flag, derived from
  `project.risk`: `3` → `critical`, `2` → `warn`, `1` → `info`, `0` → `good`.
- `computeFacets` sorts each facet by descending count, then alphabetically.

## `web/components/SummaryBar.tsx`

```tsx
export function SummaryBar(props: {
  projects: Project[];             // the full, unfiltered list
  activeSeverities: FlagSeverity[];
  onToggleSeverity: (severity: FlagSeverity) => void;
})
```

Renders a row of clickable cards. Clicking a severity card toggles that severity
filter — the summary *is* the primary filter control.

Cards, in this order:

| Card | Value |
|---|---|
| Projects | total count |
| Critical | count of `risk === 3`, `text-critical` |
| Warn | count of `risk === 2`, `text-warn` |
| Info | count of `risk === 1`, `text-info` |
| OK | count of `risk === 0`, `text-good` |
| No remote | count with `hasRemote === false && isGit === true` |
| Untracked | count with `kind === "orphan"` |
| Reclaimable | `formatBytes(sum of disposableBytes)` |

Styling: `rounded border border-border bg-panel px-3 py-2`, label in
`text-[11px] uppercase text-muted`, value in `text-lg font-semibold`. An active
severity card gets `ring-1 ring-current`.

The last three cards are not filters — render them without click handlers.

## `web/components/FilterBar.tsx`

```tsx
export function FilterBar(props: {
  filters: Filters;
  facets: Facets;
  visibleCount: number;
  totalCount: number;
  onChange: (filters: Filters) => void;
})
```

Contents, in one wrapping flex row:

1. A text input bound to `filters.query`, placeholder
   `filter by name, path or stack…`, `w-72`. Update on every keystroke; 53
   projects need no debouncing.
2. A `<select>` for group, options from `facets.groups` rendered as
   `tmp (21)`. First option `all groups` with value `""`. Single-select writes a
   one-element `groups` array.
3. A `<select>` for status: `all statuses`, then each of
   `unknown`/`active`/`obsolete`/`archived`.
4. A `<select>` for stack, options from `facets.stacks`.
5. A `<select>` for flag, options from `facets.rules`, each coloured by its
   severity via `severityColor`.
6. A checkbox `hide obsolete/archived` bound to `filters.hideResolved`.
7. A `reset` button, shown only when the filters differ from `EMPTY_FILTERS`,
   calling `onChange(EMPTY_FILTERS)`.
8. On the right, `text-xs text-muted` reading `<visibleCount> of <totalCount>`.

Single-select is deliberate: multi-select facet widgets are fiddly to build well
and the `Filters` type already supports arrays if it is wanted later.

Style all `<select>` and `<input>` elements the same:
`rounded border border-border bg-surface px-2 py-1 text-xs`.

## `web/components/ProjectTable.tsx`

```tsx
export function ProjectTable(props: {
  projects: Project[];            // already filtered and sorted
  sortKey: SortKey;
  sortDescending: boolean;
  selectedId: string | null;
  onSort: (key: SortKey) => void;
  onSelect: (id: string) => void;
})
```

- A `<table className="w-full border-collapse text-xs">`.
- A sticky header: `sticky top-0 z-10 bg-panel`.
- Columns, in this order, with the sort key they trigger:

  | Header | Sort key | Alignment |
  |---|---|---|
  | `` (risk dot, no label) | `risk` | centre |
  | Project | `name` | left |
  | Group | `group` | left |
  | Kind | — | left |
  | Stack | — | left |
  | Branch | — | left |
  | Sync | — | left |
  | Commits 90d | `commits90d` | right |
  | Last commit | `lastCommit` | right |
  | Size | `size` | right |
  | Status | — | left |
  | Flags | — | left |

- Clicking a sortable header calls `onSort(key)`. `App.tsx` toggles direction when
  the same key is clicked again. Show `▲`/`▼` on the active column.
- Non-sortable headers must not look clickable — no `cursor-pointer`.
- When `projects` is empty, render a single row spanning all columns:
  `no projects match these filters`.

## `web/components/ProjectRow.tsx`

```tsx
export function ProjectRow(props: {
  project: Project;
  selected: boolean;
  onSelect: (id: string) => void;
})
```

Cell-by-cell:

1. **Risk dot** — a 8px round `span` coloured by the project's highest severity.
   `title` attribute lists the flag labels, so a hover explains it without a click.
2. **Project** — `project.name` in `font-medium`; below it,
   `project.relPath` in `text-[10px] text-muted`. When `nestedIn` is set, prefix
   the relPath with `↳ `.
3. **Group** — `project.group`.
4. **Kind** — `project.kind`, and `text-muted` for anything other than `repo`
   since worktrees and submodules are not independent projects.
5. **Stack** — up to 3 entries from `stack`, then up to 2 from `frameworks`, each
   as a chip: `rounded bg-surface px-1 text-[10px] text-muted`. Append `+n` when
   truncated.
6. **Branch** — `project.branch ?? "detached"`, `text-warn` when `detached`.
7. **Sync** — `formatSync(project)`, coloured `text-critical` for `local-only`,
   `text-warn` when ahead or behind is non-zero, else `text-muted`.
8. **Commits 90d** — the number, or `—`.
9. **Last commit** — `formatAge(lastCommitAgeDays)`. When `lastTouchedAgeDays` is
   at least 30 days *newer* than the last commit, append a `*` with
   `title="files modified more recently than the last commit"`. That gap is exactly
   where uncommitted work hides.
10. **Size** — `formatBytes(sourceBytes)`; when `disposableBytes` exceeds
    100 MB, add `+{formatBytes(disposableBytes)}` in `text-muted`.
11. **Status** — `annotation.status`, with a snooze indicator when snoozed.
    `unknown` renders as `—` in `text-muted`: an untriaged project should look
    empty, not labelled.
12. **Flags** — up to 3 rule names as chips coloured by severity, `+n` for the
    rest. Skip `HEALTHY`; when it is the only flag, render `ok` in `text-good`.

Row behaviour:

- `onClick` calls `onSelect(project.id)`.
- `className`: `cursor-pointer border-b border-border hover:bg-panel`, plus
  `bg-panel` when `selected`, plus `opacity-50` when `project.suppressed`.
- Use `React.memo`. 53 rows re-rendering on every keystroke is avoidable.

## Changes to `web/App.tsx`

Add state:

```tsx
const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
const [sortKey, setSortKey] = useState<SortKey>("risk");
const [sortDescending, setSortDescending] = useState(true);
const [selectedId, setSelectedId] = useState<string | null>(null);
```

Derive with `useMemo`, keyed on the inputs:

```tsx
const facets = useMemo(() => computeFacets(projects), [projects]);
const visible = useMemo(
  () => sortProjects(filterProjects(projects, filters), sortKey, sortDescending),
  [projects, filters, sortKey, sortDescending],
);
```

`handleSort(key)`: when `key === sortKey`, flip `sortDescending`; otherwise set the
key and reset `sortDescending` to `true`.

Render `SummaryBar`, `FilterBar`, then `ProjectTable` inside `main`. `selectedId`
is stored now but unused until TASK 13 — that is expected.

---

## Verification

```bash
cd /path/to/repo-inventory
npm run typecheck
npm run build
npm run serve &
sleep 25
```

Open <http://127.0.0.1:4747> and check every item:

- [ ] `npm run typecheck` and `npm run build` both clean
- [ ] The summary shows a total matching the header count
- [ ] `No remote` reads between 30 and 45
- [ ] Clicking the `Critical` card filters the table to only red-dot rows, and the
      card gains a ring
- [ ] Clicking it again clears the filter
- [ ] Typing `tmp` in the search box narrows to the ~21 scratch projects
- [ ] Typing `python` narrows to python projects — proves stack is searched, not
      just the name
- [ ] Selecting group `tmp` and then flag `LOCAL_ONLY` narrows further (AND across
      categories)
- [ ] `reset` appears once a filter is set and clears everything
- [ ] The `x of y` counter is correct
- [ ] Clicking `Last commit` sorts oldest-last, clicking again reverses, and
      projects with no commits stay at the bottom **both** times
- [ ] Sorting by `Size` puts the largest project first
- [ ] Nested repos show the `↳` prefix
- [ ] Worktree rows show kind `worktree` in muted text
- [ ] A healthy project shows a green dot and `ok`
- [ ] The header stays fixed while the table scrolls
- [ ] No console errors, no React key warnings
- [ ] Typing in the search box feels instant

Then `kill %1`.

## Report back

The eight summary card values, and the top five rows when sorted by risk
(project, sync, flags).
