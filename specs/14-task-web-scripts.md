# TASK 14 — Web: multi-select and action scripts

**Goal:** select several projects, pick an action, and get a shell script to
review and run.

**Files you create:**

- `web/components/SelectionBar.tsx`
- `web/components/ScriptModal.tsx`

**Files you modify:**

- `web/App.tsx` — selection state and modal wiring
- `web/components/ProjectTable.tsx` — a checkbox column plus a header
  select-all checkbox
- `web/components/ProjectRow.tsx` — the checkbox cell

**Files you must not touch:** everything else.

---

## Terminology warning

TASK 12 and 13 use `selectedId` for the **one** project shown in the detail panel.
This task adds a **different** concept: a set of checked projects for bulk
actions. Name it `checkedIds` throughout. Do not overload `selectedId`.

## Changes to `ProjectTable.tsx`

New props:

```tsx
checkedIds: Set<string>;
onToggleChecked: (id: string) => void;
onToggleAll: () => void;
```

- Insert a first column before the risk dot, header content = a checkbox.
- The header checkbox is `checked` when every visible project is checked and there
  is at least one, and `indeterminate` when some are. `indeterminate` is not a JSX
  attribute — set it via a ref:
  ```tsx
  <input ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }} … />
  ```
- `onToggleAll` operates on the **currently visible** projects only. Selecting
  things hidden behind a filter is how people accidentally archive the wrong
  repository.

## Changes to `ProjectRow.tsx`

New props: `checked: boolean`, `onToggleChecked: (id: string) => void`.

- Add a leading `<td>` with a checkbox bound to `checked`.
- Its `onClick` must call `event.stopPropagation()` so ticking a box does not also
  open the detail panel.
- Keep the `React.memo` wrapper working: `checked` is a primitive, so the default
  shallow comparison is still correct.

## `web/components/SelectionBar.tsx`

```tsx
export function SelectionBar(props: {
  checkedProjects: Project[];
  actions: ActionMeta[];
  onClear: () => void;
  onGenerate: (actionName: string) => void;
  busy: boolean;
})
```

- Return `null` when `checkedProjects` is empty. No empty toolbar taking up space.
- Otherwise a sticky bar at the bottom of the table column:
  `sticky bottom-0 flex items-center gap-3 border-t border-border bg-panel px-4 py-2`.
- Left: `<n> selected`, and below it the first three names plus `+n more` in
  `text-[10px] text-muted`, so the user can see what they are about to act on.
- Middle: one button per action, labelled `action.label`, `title={action.description}`.
  Do **not** show a per-action eligible count. Eligibility is decided by
  `action.appliesTo` on the server, and re-implementing those predicates in the
  frontend would drift out of sync. The server's `skipped` list reports what was
  not eligible, after the fact and truthfully.
- Right: a `clear` button calling `onClear`.
- Disable all buttons while `busy`.

## `web/components/ScriptModal.tsx`

```tsx
export function ScriptModal(props: {
  action: ActionMeta;
  result: ScriptResult;
  onClose: () => void;
})
```

A centred overlay:

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8">
  <div className="flex max-h-full w-[840px] flex-col rounded border border-border bg-panel">
```

Contents:

1. **Header** — `action.label`, then `action.description` in `text-xs text-muted`.
2. **A warning banner**, always visible, `border border-warn bg-warn/10 text-warn`,
   reading:
   `Nothing has been executed. Read every line, then run it yourself.`
   This is not decoration — it is the contract the whole actions design rests on.
3. **Included / skipped** — `result.included.length` projects included. When
   `result.skipped.length > 0`, list the skipped `relPath`s under
   `skipped (not eligible for this action)` in `text-muted`. Never hide a skip.
4. **The script** in a `<pre className="min-h-0 flex-1 overflow-auto bg-surface p-3 text-[11px] leading-relaxed">`.
5. **Footer buttons**:
   - `copy` — `navigator.clipboard.writeText(result.script)`, then show `copied`
     for 1.5 s.
   - `download` — build a `Blob` with type `text/x-shellscript`, `URL.createObjectURL`,
     click a synthetic `<a>` with
     `download={`repo-inventory-${action.name}-${YYYYMMDD}.sh`}`, then
     `URL.revokeObjectURL`.
   - `close`.

Close on `Escape` and on a click on the backdrop (but not on the inner panel —
check `event.target === event.currentTarget`).

There is deliberately no `run` button. The user chose dry-run-only; do not add
one, and do not add a "copy and run" convenience.

## Changes to `web/App.tsx`

New state:

```tsx
const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
const [script, setScript] = useState<{ action: ActionMeta; result: ScriptResult } | null>(null);
const [generating, setGenerating] = useState(false);
```

Handlers:

- `toggleChecked(id)` — copy the Set, add or delete, set state. Never mutate the
  existing Set; React will not re-render.
- `toggleAll()` — when every visible project is already checked, remove exactly
  those; otherwise add all visible ids.
- `handleGenerate(actionName)` — set `generating`, call
  `generateScript(actionName, [...checkedIds])`, store the result with the matching
  `ActionMeta` from `inventory.actions`, clear `generating` in a `finally`, surface
  failures through the existing top-level `error` state.
- Clear `checkedIds` whenever a rescan completes. Ids can disappear between scans,
  and acting on a stale id must be impossible.

Render:

- `SelectionBar` at the bottom of the table column.
- `ScriptModal` when `script !== null`.

---

## Verification

```bash
cd /path/to/repo-inventory
npm run typecheck
npm run build
npm run serve &
sleep 25
```

In the browser:

- [ ] `npm run typecheck` and `npm run build` clean
- [ ] Ticking a row's checkbox does **not** open the detail panel
- [ ] Clicking the row body still opens the detail panel
- [ ] The selection bar appears on the first tick and disappears when cleared
- [ ] The header checkbox goes indeterminate with a partial selection
- [ ] Filter to group `tmp`, click select-all: only the ~21 visible projects get
      checked. Clear the filter and confirm the rest are untouched
- [ ] `Move out of a scratch folder` on a few `tmp` projects produces a script
      containing `#!/usr/bin/env bash`, `set -euo pipefail`, `ROOT="…"`, and a
      `mv` guarded by `if [ -e "$DEST" ]`
- [ ] Selecting a project the action does not apply to lists it under `skipped`
- [ ] `Publish to a remote` produces a script where every `gh repo create` line is
      commented out
- [ ] `Archive` on a project with no remote produces the `# SKIPPED` refusal block,
      not a `tar`/`rm` pair
- [ ] `copy` puts the script on the clipboard; paste it into a terminal **without
      running it** and confirm it matches
- [ ] `download` saves a `.sh` file
- [ ] `Escape` and a backdrop click close the modal; a click inside does not
- [ ] Running a rescan clears the selection
- [ ] No console errors

Then `kill %1`.

## Report back

The full generated script for `graduate` over three `tmp` projects, and the
`skipped` list from an intentionally mixed selection.
