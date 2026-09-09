# TASK 08 — Actions: dry-run shell scripts

**Goal:** four action plugins that generate shell script text for bulk cleanup.

**Files you create:**

- `actions/10-publish.ts`
- `actions/20-graduate.ts`
- `actions/30-archive.ts`
- `actions/40-reclaim-space.ts`

**Files you must not touch:** everything else.

---

## Absolute safety rule

Actions produce **text**. They never execute anything.

- No `actions/*.ts` file may import `core/exec.ts`, `node:child_process`,
  `node:fs`, or anything else with side effects.
- The only imports allowed are `import type { Action, Project } from "../core/types.ts";`.
- The user reads the generated script and runs it themselves. If your generated
  script is wrong, the user loses work. Write it as if that will happen.

## Contract

```ts
interface Action {
  name: string;
  label: string;
  description: string;
  appliesTo: (project: Project) => boolean;
  script: (project: Project, root: string) => string[];
}
```

`script` returns the lines for **one** project. The caller (TASK 09) concatenates
them under a shared header. Do **not** emit a shebang or `set -euo pipefail`
yourself — the caller adds those once.

## Shared conventions for generated lines

- Always quote paths: `"$ROOT/tmp/foo"`. The caller defines
  `ROOT="/path/to/code"` in the header, so use `$ROOT` and build
  paths from `project.relPath`, never from `project.path`.
- Start each project's block with a comment naming it:
  `# ── tmp/aitrader ──────────`
- Precede every irreversible line with a comment stating exactly what is lost.
- Prefer `git mv`-free plain `mv` for whole directories; `git mv` only works
  inside a repo.
- Never emit `rm -rf` on anything other than a directory name that appears in
  `DISPOSABLE_DIRS` (`node_modules`, `.venv`, `dist`, `build`, `target`, `obj`,
  `Pods`, `DerivedData`, `.next`, `.turbo`, `.nx`, `.cache`, `coverage`,
  `__pycache__`, `out`, `venv`).
- When a step needs a decision the tool cannot make, emit it **commented out**
  with a `# EDIT:` marker rather than guessing.

---

## Action 1 — `actions/10-publish.ts`

```
name: "publish"
label: "Publish to a remote"
description: "Create a GitHub repo and push, for projects that exist only on this machine."
```

`appliesTo`: `project.isGit === true && project.hasRemote === false && project.kind === "repo"`

`script` emits:

1. The project header comment.
2. `cd "$ROOT/<relPath>"`
3. A comment reporting the facts: commit count and current branch, e.g.
   `# 412 commits on branch main, currently no remote`
4. A commented-out `gh repo create` line the user must edit:
   ```
   # EDIT: choose visibility and owner, then uncomment
   # gh repo create "<name>" --private --source=. --remote=origin --push
   ```
   Use `project.name` for the repo name.
5. A commented-out plain-git alternative for non-GitHub hosts:
   ```
   # Or, for a non-GitHub remote:
   # git remote add origin "git@example.com:you/<name>.git"
   # git push -u origin "<branch>"
   ```
   Use `project.branch ?? "main"`.
6. A blank line.

Everything here is commented out on purpose. Publishing is the one action where a
wrong guess about visibility could expose private code, so the tool refuses to
decide.

## Action 2 — `actions/20-graduate.ts`

```
name: "graduate"
label: "Move out of a scratch folder"
description: "Relocate an active project from tmp/ into a permanent home."
```

`appliesTo`: the first path segment of `project.relPath` is one of
`tmp`, `test`, `scratch`, `sandbox`, `playground`. Declare that list as a
module-level `const`.

`script` emits:

1. Header comment.
2. A facts comment: commits in the last 90 days and the last commit age, e.g.
   `# 34 commits in 90d, last commit 2d ago — this is not scratch work`
3. The destination as an editable variable:
   ```
   DEST="$ROOT/projects/<name>"   # EDIT: pick the permanent home
   ```
4. A guard that refuses to clobber:
   ```
   if [ -e "$DEST" ]; then echo "skip <relPath>: $DEST exists"; else
     mkdir -p "$(dirname "$DEST")"
     mv "$ROOT/<relPath>" "$DEST"
     echo "moved <relPath> -> $DEST"
   fi
   ```
5. A warning comment when `project.hasRemote === false`:
   `# WARNING: no remote — publish this before moving it, or a mistake loses everything`
6. A warning comment when `project.nestedIn !== null`:
   `# WARNING: nested inside <nestedIn>; check the parent repo's .gitignore after moving`
7. A blank line.

Note `DEST` is reassigned per project. That is fine inside a single script since
each block uses it immediately.

## Action 3 — `actions/30-archive.ts`

```
name: "archive"
label: "Archive"
description: "Compress a finished project into archive/ and remove the working copy."
```

`appliesTo`: `project.annotation.status === "obsolete" || project.annotation.status === "archived"`

Only offered for projects the user has already judged. Never guess that something
is dead.

`script` emits:

1. Header comment, including the user's note when present:
   `# note: <annotation.note>` — strip newlines from the note first.
2. A refusal guard when there is unsaved value. If
   `(project.ahead ?? 0) > 0 || (project.dirtyFiles ?? 0) > 0 || (project.hasRemote === false)`,
   emit **only** a comment block and stop:
   ```
   # SKIPPED <relPath>: has unpushed or uncommitted work, or no remote.
   # Run the "publish" action first. Archiving this would destroy the only copy.
   ```
   This is the most important line of code in this task.
3. Otherwise:
   ```
   mkdir -p "$ROOT/archive"
   tar -czf "$ROOT/archive/<flatname>-$(date +%Y%m%d).tar.gz" -C "$ROOT" "<relPath>"
   # removes the working copy; the tarball above and the git remote are the remaining copies
   rm -rf "$ROOT/<relPath>"
   ```
   `<flatname>` is `relPath` with `/` replaced by `-`.
4. A blank line.

## Action 4 — `actions/40-reclaim-space.ts`

```
name: "reclaim-space"
label: "Delete build output"
description: "Remove node_modules, .venv, dist and friends. All of it is regenerable."
```

`appliesTo`: `(project.disposableBytes ?? 0) > 50 * 1024 * 1024`

`script` emits:

1. Header comment stating how much is reclaimable, in GB with one decimal.
2. One `find` invocation per disposable directory name, scoped to the project:
   ```
   find "$ROOT/<relPath>" -type d -name "node_modules" -prune -exec rm -rf {} +
   ```
   Emit lines for exactly these names, in this order: `node_modules`, `.venv`,
   `venv`, `__pycache__`, `dist`, `build`, `out`, `.next`, `.turbo`, `.nx`,
   `target`, `obj`, `Pods`, `DerivedData`, `.cache`, `coverage`.
   `-prune` matters: without it `find` descends into a directory it just deleted.
3. A blank line.

Declare the name list as a module-level `const` array rather than repeating it.

---

## Verification

```bash
cd /path/to/repo-inventory
npm run typecheck
```

Then:

```bash
cat > /tmp/smoke-actions.ts <<'EOF'
const BASE = "/path/to/repo-inventory";
const { loadRegistry } = await import(`${BASE}/core/registry.ts`);
const { readInventory } = await import(`${BASE}/core/scan.ts`);

const { actions } = await loadRegistry(BASE);
console.log("actions:", actions.map((a) => a.name).join(", "));

const inv = await readInventory(BASE);
if (!inv) throw new Error("scan first");
for (const action of actions) {
  const matches = inv.projects.filter((p) => action.appliesTo(p));
  console.log(`\n=== ${action.name} — ${matches.length} projects ===`);
  const sample = matches[0];
  if (sample) console.log(action.script(sample, inv.root).join("\n"));
}
EOF
node /tmp/smoke-actions.ts
rm /tmp/smoke-actions.ts

grep -rn "child_process\|core/exec\|node:fs" actions/ || echo "OK: actions are side-effect free"
```

Checklist:

- [ ] `npm run typecheck` clean
- [ ] `actions: publish, graduate, archive, reclaim-space`
- [ ] The `grep` prints `OK: actions are side-effect free`
- [ ] `publish` matches roughly 38 projects
- [ ] `graduate` matches roughly 21 projects
- [ ] `archive` matches **0** projects (nothing is annotated yet) — correct
- [ ] Every `rm -rf` in the printed output targets either a disposable directory
      name or a path guarded by the archive tarball step
- [ ] Every `gh repo create` line is commented out
- [ ] `/tmp/smoke-actions.ts` deleted

## Report back

The action list, the per-action match counts, and the full generated script for
the `graduate` sample.
