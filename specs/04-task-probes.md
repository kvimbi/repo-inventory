# TASK 04 — Probes: collect the facts

**Goal:** six probe files that fill in every optional field of `ProjectFacts`.

**Files you create:**

- `probes/15-git-fetch.ts`
- `probes/20-git-sync.ts`
- `probes/30-git-activity.ts`
- `probes/40-stack.ts`
- `probes/50-agent-tooling.ts`
- `probes/60-footprint.ts`

**File you modify:** `core/discover.ts` — one function only, see Step 6.

**Files you must not touch:** everything else, especially `probes/10-git-basics.ts`.

---

## Shared shape of every probe file

```ts
import type { Probe } from "../core/types.ts";

export const probe: Probe = {
  name: "…",
  order: …,
  appliesTo: (facts) => …,
  async detect({ path, facts, run, fetch, pruneDirs, root }) {
    …
    return { /* only the fields this probe owns */ };
  },
};
```

Reminders that will bite you if ignored:

- `run(cmd, args)` takes **no cwd** — it already runs in the project directory.
- `run` never throws. Always check `.ok` before touching `.stdout`.
- Return **only** the fields your probe owns. The pipeline shallow-merges.
- Never return `0` for something you could not measure. Omit the field.
- `order` decides sequence. `10-git-basics` is `order: 0`.

---

## Step 1 — `probes/15-git-fetch.ts`

`name: "git-fetch"`, `order: 15`.

`appliesTo`: `facts.isGit === true && facts.hasRemote === true`

`detect`:

- If `ctx.fetch` is **false**, return nothing immediately. This is the default
  path and must cost zero network calls.
- Otherwise, if `facts.remoteName` is null return nothing, else run:

  ```
  git fetch --prune --quiet <remoteName>
  ```

  `ctx.run` applies its own 15 s timeout, which you cannot override. That is
  acceptable: a remote that cannot answer in 15 s is a remote the user needs to
  know about, and the failure is recorded rather than silently retried.
- Return nothing on success. This probe exists purely for its side effect of
  updating remote-tracking refs so that `probes/20-git-sync.ts` can compute a
  truthful ahead/behind.
- On failure, return `{ extra: { ...facts.extra, fetchError: <first line of stderr> } }`.
  A failed fetch is expected (no auth, host down) and must not break the scan.

Why a separate probe rather than a step inside the scanner: fetching is a policy
decision the user toggles, and expressing it as a plugin keeps the pipeline
generic. Deleting this file must degrade the tool gracefully, not break it.

## Step 2 — `probes/20-git-sync.ts`

`name: "git-sync"`, `order: 20`, `appliesTo`: `facts.isGit === true`.

Run these and parse exactly as described.

### `ahead` / `behind` / `noUpstream`

```
git rev-list --left-right --count HEAD...@{upstream}
```

- On success stdout is `"<ahead>\t<behind>"`. Split on whitespace, `Number()`
  both, set `noUpstream: false`.
- On failure the branch has no upstream (or the repo has no commits). Set
  `noUpstream: true` and **omit** `ahead`/`behind` entirely.

### `dirtyFiles` / `untrackedFiles`

```
git status --porcelain=v1 --untracked-files=normal
```

- Split stdout on `\n`, drop empty lines.
- Lines starting with `??` → count into `untrackedFiles`.
- All other lines → count into `dirtyFiles`. Staged and unstaged are collapsed on
  purpose: the user only cares that uncommitted work exists.
- On failure omit both fields.

### `stashes`

```
git stash list
```

Count non-empty lines. On failure omit.

### `localOnlyBranches`

```
git for-each-ref --format=%(refname:short)%09%(upstream) refs/heads
```

- Each line is `branchname\tupstream-or-empty`. Split on `\t`.
- Collect branch names whose upstream part is empty or missing.
- Cap the returned array at 20 entries to keep the JSON small.
- On failure omit.

These are branches that exist **only on this laptop**. Combined with `NO_REMOTE`
they are the highest-value signal in the whole tool.

### `lastFetchAt`

- Find the shared git directory:
  ```
  git rev-parse --path-format=absolute --git-common-dir
  ```
  Use `--git-common-dir`, not `--git-dir`: a linked worktree has its own
  `.git` dir but shares `FETCH_HEAD` with the main checkout.
- `stat` the file `<common-dir>/FETCH_HEAD` with `node:fs/promises`.
- Set `lastFetchAt` to `stats.mtime.toISOString()`.
- If either step fails, set `lastFetchAt: null` — meaning "never fetched", which
  is a meaningful answer, unlike omitting it.

## Step 3 — `probes/30-git-activity.ts`

`name: "git-activity"`, `order: 30`, `appliesTo`: `facts.isGit === true`.

### `lastCommitAt`, `lastCommitSubject`, `lastCommitAgeDays`

```
git log -1 --format=%cI%x09%s
```

- Split on the first `\t`: ISO date, then subject.
- `lastCommitAgeDays` = whole days between that date and now,
  `Math.floor((Date.now() - date.getTime()) / 86_400_000)`.
- On failure (a repo with no commits — this really happens here) set all three to
  `null`.

### Commit counts

```
git rev-list --count --all --since=30.days
git rev-list --count --all --since=90.days
git rev-list --count --all
```

`--all` on purpose: work sitting on a feature branch still counts as activity.
Parse with `Number()`. Guard `Number.isFinite` before assigning; omit on failure.

### `authors`

```
git log --all --format=%aN -n 400
```

Deduplicate preserving first-seen order, keep at most 5. Omit on failure.

Rationale for the 400 cap: this is only used to tell "mine" from "a clone of
someone else's project", and reading full history of a large repo is wasted time.

### `lastTouchedAt` / `lastTouchedAgeDays`

Do **not** compute these here. `probes/60-footprint.ts` already walks every file
and will produce them. Omit from this probe.

## Step 4 — `probes/40-stack.ts`

`name: "stack"`, `order: 40`, **no `appliesTo`** — untracked projects need a stack
verdict most of all.

Walk the project directory yourself with `node:fs/promises`, honouring
`ctx.pruneDirs`, to a **maximum depth of 3** below the project root. Collect the
relative paths of recognised manifests.

Build two string arrays, `stack` (ecosystems) and `frameworks` (notable
libraries/tools). Deduplicate and sort both before returning.

### Ecosystem detection — by filename

| Match | `stack` entry |
|---|---|
| `package.json` | `node` |
| `deno.json`, `deno.jsonc` | `deno` |
| `pyproject.toml`, `requirements.txt`, `Pipfile`, `setup.py`, `uv.lock` | `python` |
| `*.csproj`, `*.fsproj`, `*.sln` | `dotnet` |
| `go.mod` | `go` |
| `Cargo.toml` | `rust` |
| `pom.xml`, `build.gradle`, `build.gradle.kts` | `jvm` |
| `Package.swift`, `*.xcodeproj`, `*.xcworkspace` | `swift` |
| `pubspec.yaml` | `dart` |
| `Gemfile` | `ruby` |
| `composer.json` | `php` |
| `mix.exs` | `elixir` |
| `Dockerfile`, `docker-compose.y*ml` | `docker` |
| `*.tf`, `*.tfvars` | `terraform` |
| `Chart.yaml`, `kustomization.y*ml`, `skaffold.y*ml` | `kubernetes` |

### Framework detection — from `package.json`

Read and `JSON.parse` every `package.json` you found (wrap each in try/catch;
a malformed manifest must not break the scan). Merge `dependencies`,
`devDependencies` and `peerDependencies` key sets, then map:

| Dependency key present | `frameworks` entry |
|---|---|
| `react` | `react` |
| `next` | `nextjs` |
| `vue` | `vue` |
| `svelte` | `svelte` |
| `@angular/core` | `angular` |
| `react-native` or `expo` | `react-native` |
| `electron` | `electron` |
| `express` | `express` |
| `fastify` | `fastify` |
| `@nestjs/core` | `nestjs` |
| `vite` | `vite` |
| `typescript` | `typescript` |
| `tailwindcss` | `tailwind` |
| `@modelcontextprotocol/sdk` | `mcp` |
| `vitest` or `jest` | `tests` |

Also, from the root `package.json` only: if it has a `workspaces` key, add
`frameworks: "workspaces"` and set `isMonorepo: true`.

### Framework detection — from Python manifests

Read `pyproject.toml` / `requirements.txt` as **plain text** (there is no TOML
parser available and you may not add one). Case-insensitive substring search:

| Text contains | `frameworks` entry |
|---|---|
| `fastapi` | `fastapi` |
| `django` | `django` |
| `flask` | `flask` |
| `pydantic` | `pydantic` |
| `streamlit` | `streamlit` |
| `langchain` | `langchain` |
| `mcp` | `mcp` |
| `pandas` | `pandas` |

### Monorepo detection

Set `isMonorepo: true` and add the matching framework when any of these exist at
the project root: `nx.json` → `nx`, `pnpm-workspace.yaml` → `pnpm-workspace`,
`turbo.json` → `turborepo`, `lerna.json` → `lerna`.

`packageCount`: the number of `package.json` files found, **including** the root
one. Only set it when it is greater than 1.

### Returned fields

`stack`, `frameworks`, `manifests` (relative paths, capped at 40 entries,
sorted), `isMonorepo` (only when true), `packageCount` (only when > 1).

## Step 5 — `probes/50-agent-tooling.ts`

`name: "agent-tooling"`, `order: 50`, no `appliesTo`.

Check for existence at the **project root only** (`node:fs/promises` `stat`,
catch and treat as absent):

| Path | `agentTooling` entry |
|---|---|
| `.claude/` | `claude` |
| `CLAUDE.md` | `claude-md` |
| `.opencode/` | `opencode` |
| `AGENTS.md` | `agents-md` |
| `.cursor/` or `.cursorrules` | `cursor` |
| `.github/copilot-instructions.md` | `copilot` |
| `.mcp.json` | `mcp-config` |
| `.windsurfrules` | `windsurf` |

Return `agentTooling` sorted, and omit the field entirely when nothing was found.

Purpose: the user works with coding agents heavily. Which projects are already
set up for agents is a real dimension for deciding what is live.

## Step 6 — extend `measureFootprint`, then write `probes/60-footprint.ts`

### 6a — modify `core/discover.ts`

Change **only** `measureFootprint`. Add a fourth number to its result:

```ts
export async function measureFootprint(
  dir: string,
  prune: Set<string>,
  disposable: Set<string>,
): Promise<{
  sourceBytes: number;
  disposableBytes: number;
  sourceFiles: number;
  newestMtimeMs: number;   // 0 when no files were readable
}>
```

Implementation change: the existing `walk` already calls `stat` on every source
file. In that same block, keep the maximum of `stats.mtimeMs`. Do **not** track
mtimes inside `sizeOf` — disposable directories are rebuilt constantly and their
timestamps say nothing about the user's activity.

Do not change anything else in the file.

### 6b — write `probes/60-footprint.ts`

`name: "footprint"`, `order: 60`, no `appliesTo`.

- Import `measureFootprint` from `../core/discover.ts` and `DISPOSABLE_DIRS` from
  `../core/config.ts`.
- Call `measureFootprint(ctx.path, ctx.pruneDirs, DISPOSABLE_DIRS)`.
- Return `sourceBytes`, `disposableBytes`, `sourceFiles`.
- Derive `lastTouchedAt` from `newestMtimeMs`: `new Date(ms).toISOString()`, or
  `null` when `newestMtimeMs === 0`. Derive `lastTouchedAgeDays` the same way as
  `lastCommitAgeDays` in Step 3, or `null`.
- `hasReadme`: true when any of `README.md`, `README.rst`, `README.txt`,
  `readme.md` exists at the project root.

---

## Verification

```bash
cd /path/to/repo-inventory
npm run typecheck
```

Zero errors required. Then run this probe harness (create, run, **delete**):

```bash
cat > /tmp/smoke-probes.ts <<'EOF'
const BASE = "/path/to/repo-inventory";
const { loadConfig } = await import(`${BASE}/core/config.ts`);
const { discover } = await import(`${BASE}/core/discover.ts`);
const { loadRegistry } = await import(`${BASE}/core/registry.ts`);
const { run } = await import(`${BASE}/core/exec.ts`);

const config = await loadConfig(BASE);
const registry = await loadRegistry(BASE);
console.log("probes:", registry.probes.map((p) => `${p.order ?? 100}:${p.name}`).join(" "));

const all = await discover(config);
const targets = ["tmp/studio_resco", "personal/rmmt", "web-projects-nx", "k8s"];
for (const facts of all.filter((p) => targets.includes(p.relPath))) {
  let merged = { ...facts };
  for (const probe of registry.probes) {
    if (probe.appliesTo && !probe.appliesTo(merged)) continue;
    const out = await probe.detect({
      path: merged.path, facts: merged, root: config.root, fetch: false,
      run: (cmd, args) => run(merged.path, cmd, args),
      pruneDirs: new Set(config.pruneDirs),
    });
    if (out) merged = { ...merged, ...out };
  }
  console.log(JSON.stringify(merged, null, 2));
}
EOF
node /tmp/smoke-probes.ts
rm /tmp/smoke-probes.ts
```

Checklist against the output:

- [ ] The probe order line reads `0:git-basics 15:git-fetch 20:git-sync 30:git-activity 40:stack 50:agent-tooling 60:footprint`
- [ ] `tmp/studio_resco` shows `hasRemote: false`, a non-empty `localOnlyBranches`,
      a real `lastCommitAt`, and `agentTooling` containing `claude` and `opencode`
- [ ] `web-projects-nx` shows `stack` containing `node` and `isMonorepo: true`
- [ ] Every project shown has `sourceBytes > 0` and a non-null `lastTouchedAt`
- [ ] No field anywhere is `NaN`
- [ ] No probe threw; the script exits 0
- [ ] `/tmp/smoke-probes.ts` deleted

## Report back

The probe order line, and for `tmp/studio_resco`: `localOnlyBranches`,
`lastCommitAt`, `stack`, `frameworks`, `sourceBytes`, `disposableBytes`.
