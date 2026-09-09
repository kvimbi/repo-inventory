# TASK 13 — Web: detail drawer and annotation editing

**Goal:** clicking a row opens a detail panel showing everything the scan knows,
and lets the user record a decision: status, note, snooze.

This is the feature the user actually asked for. Everything before it was
plumbing.

**Files you create:**

- `web/components/DetailPanel.tsx`
- `web/components/AnnotationEditor.tsx`
- `web/components/FactList.tsx`

**File you modify:** `web/App.tsx` — render the panel and wire the save callback.

**Files you must not touch:** everything else.

---

## `web/components/DetailPanel.tsx`

```tsx
export function DetailPanel(props: {
  project: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
})
```

A right-hand drawer, not a modal — the user compares the panel against the table.

```tsx
<aside className="flex w-[420px] shrink-0 flex-col overflow-auto border-l border-border bg-panel">
```

Sections, top to bottom:

### Header

- `project.name` in `text-sm font-semibold`.
- `project.relPath` in `text-xs text-muted`, selectable.
- A copy button that writes the **absolute** `project.path` to the clipboard via
  `navigator.clipboard.writeText`, showing `copied` for 1.5 s. The user's next
  action after reading this panel is almost always `cd` into the project.
- A close button (`×`) calling `onClose`.

### Flags

Every flag as a block, ordered as they arrive (rules are already in priority
order):

```tsx
<div className="border-l-2 pl-2" /* border colour = severity */>
  <div className="text-xs font-medium">{flag.label}</div>
  {flag.detail && <div className="text-[11px] text-muted">{flag.detail}</div>}
  <div className="text-[10px] text-muted">{flag.rule}</div>
</div>
```

When `project.suppressed` is true, show a line above them:
`non-critical flags hidden because this project is <status>/snoozed`. The user
must know they are looking at a filtered view.

### Annotation editor

Render `<AnnotationEditor project={project} onSaved={onSaved} />`.

### Facts

Render `<FactList project={project} />`.

### Raw

A collapsed `<details>` with `<summary>raw facts</summary>` and a
`<pre className="overflow-auto text-[10px] text-muted">` containing
`JSON.stringify(project, null, 2)`. Cheap escape hatch for anything the curated
view omits.

## `web/components/AnnotationEditor.tsx`

```tsx
export function AnnotationEditor(props: {
  project: Project;
  onSaved: (project: Project) => void;
})
```

Local state mirrors the annotation, seeded from `props.project.annotation`:

```tsx
const [status, setStatus] = useState(project.annotation.status);
const [note, setNote] = useState(project.annotation.note);
const [snoozedUntil, setSnoozedUntil] = useState(project.annotation.snoozedUntil);
const [saving, setSaving] = useState(false);
const [saveError, setSaveError] = useState<string | null>(null);
```

Reset all of it when `project.id` changes. Use `key={project.id}` on the element in
`DetailPanel` rather than a `useEffect` — remounting is simpler and cannot get the
dependency array wrong.

### Status control

Four buttons in a row, one per `ProjectStatus`, not a `<select>`. Marking things
obsolete is the core loop; it should be one click.

- Labels: `unknown`, `active`, `obsolete`, `archived`.
- The active one gets `bg-border`; the rest `bg-surface`.
- Clicking saves **immediately** — no separate confirm. It is a reversible label.

### Note

A `<textarea rows={3}>` bound to `note`, placeholder
`why does this exist? what is it superseded by?`.

- Saves on **blur**, and only when the value differs from
  `project.annotation.note`. Saving per keystroke would write the file on every
  character.
- Enforce the server's 2000-character limit client-side with `maxLength={2000}`
  and show a counter once past 1900.

### Snooze

- An `<input type="date">` bound to the date part of `snoozedUntil`.
- Three quick buttons: `+1 week`, `+1 month`, `+3 months`, computing the date from
  today.
- A `clear` button, shown only when a snooze is set, which saves
  `snoozedUntil: null`.
- Below the control, when snoozed, `text-muted` text:
  `flags hidden until <formatted date>; data-loss flags still shown`. Do not let
  the user believe a snooze hides `UNPUSHED_WORK` — it does not, by design.

### Saving

One shared function:

```tsx
async function save(patch: AnnotationPatch) {
  setSaving(true);
  setSaveError(null);
  try {
    const result = await saveAnnotation(project.id, patch);
    if (result.project) props.onSaved(result.project);
  } catch (error) {
    setSaveError(error instanceof Error ? error.message : String(error));
  } finally {
    setSaving(false);
  }
}
```

- Send **only** the fields being changed. Sending an unchanged `note` alongside a
  status change is harmless but sending an empty one would erase it.
- While `saving`, disable the controls and show `saving…` in `text-muted`.
- Render `saveError` in `text-critical` and keep the local edits on screen so the
  user does not lose typing.
- Show `updated <formatTimestamp(annotation.updatedAt)>` when it is non-empty.

## `web/components/FactList.tsx`

```tsx
export function FactList(props: { project: Project })
```

A definition list of everything the scan collected, grouped with small headings.
**Omit any row whose value is `undefined`** — an absent fact must not render as
`0` or `—`, because "we did not measure it" and "it is zero" are different facts.

Groups and rows:

**Identity** — `kind`, `group`, `depth`, `nestedIn`, `id`

**Git** — `branch`, `branchCount`, `remoteName`, `remoteUrl` (as a link when it
starts with `http`), `remoteHost`, `defaultBranch`, `detached`

**Sync** — `ahead`, `behind`, `noUpstream`, `dirtyFiles`, `untrackedFiles`,
`stashes`, `localOnlyBranches` (as chips), `lastFetchAt` (via `formatTimestamp`,
or `never` when null)

**History** — `lastCommitAt` (`formatTimestamp`), `lastCommitSubject`,
`lastCommitAgeDays` (`formatAge`), `commits30d`, `commits90d`, `commitsTotal`,
`authors` (joined), `lastTouchedAt` (`formatTimestamp`)

**Stack** — `stack` (chips), `frameworks` (chips), `isMonorepo`, `packageCount`,
`agentTooling` (chips), `manifests` (in a scrolling `max-h-24` block)

**Footprint** — `sourceBytes` (`formatBytes`), `disposableBytes` (`formatBytes`),
`sourceFiles`, `hasReadme`

Render a group heading only when at least one row in it is present. Booleans
render as `yes`/`no`, never `true`/`false`.

Layout: `grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[11px]`, keys in
`text-muted`, values wrapping with `break-all`.

## Changes to `web/App.tsx`

- Derive the selected project:
  ```tsx
  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );
  ```
  Deriving rather than storing the object means an annotation save automatically
  refreshes the panel.
- Change `main` into a horizontal flex: the existing content in a
  `min-w-0 flex-1 overflow-auto` column, and `DetailPanel` beside it when
  `selected !== null`.
- Pass `onSaved={handleAnnotationSaved}` — already implemented in TASK 11.
- Add an `Escape` key listener that clears `selectedId`. Register it in a
  `useEffect` and **remove it on cleanup**.

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
- [ ] Clicking any row opens the drawer; the table stays visible and usable
- [ ] `Escape` closes it; so does the `×`
- [ ] The copy button copies the absolute path and shows `copied`
- [ ] Flags in the panel match the chips in the row
- [ ] Clicking `obsolete` updates the row's Status cell immediately, without a
      page reload and without a rescan
- [ ] With `hide obsolete/archived` checked, that row disappears from the table
- [ ] The row goes `opacity-50` and its non-critical flags vanish, while a
      `LOCAL_ONLY` or `UNPUSHED_WORK` flag **remains** — this is the `alwaysApply`
      guarantee and is the single most important check in this task
- [ ] Typing a note and clicking elsewhere saves it; reloading the page shows it
      still there
- [ ] `jq '.annotations' data/annotations.json` contains the note
- [ ] `+1 month` sets a date and the "flags hidden until" line appears
- [ ] `clear` removes the snooze and the flags return
- [ ] Setting status back to `unknown` with an empty note removes the entry from
      `data/annotations.json` entirely
- [ ] Switching between rows resets the editor — no note leaks from one project to
      another
- [ ] `FactList` on an orphan project shows no Git or Sync group at all
- [ ] `FactList` shows no row reading `undefined` or `NaN`
- [ ] No console errors

Then `kill %1`.

## Report back

Confirm the `alwaysApply` check explicitly: name the project you marked obsolete
and list which flags remained visible. Then paste the resulting
`data/annotations.json`.
