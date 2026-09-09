# 01 — Current state

Everything listed here **already exists and works**. Do not rewrite it. Import
from it. Exact signatures are reproduced so you do not have to guess.

Paths are relative to `/path/to/repo-inventory`.

---

## `package.json`

- `"type": "module"` — ESM only.
- Scripts already declared: `scan`, `report`, `serve`, `build`, `dev`, `typecheck`.
  They call `node bin/inventory.ts <command>` (TASK 10) or `vite`.
- Dependencies: `fastify`, `@fastify/static`.
- Dev dependencies: `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`,
  `tailwindcss`, `react`, `react-dom`, `typescript`, `@types/node`,
  `@types/react`, `@types/react-dom`.
- **The dependency list is final. Do not add packages.**

## `tsconfig.json`

Key flags you must respect:

- `"erasableSyntaxOnly": true` — Node runs `.ts` files directly by stripping
  types. See `02-conventions.md` for what this forbids.
- `"verbatimModuleSyntax": true` — type-only imports **must** use `import type`.
- `"allowImportingTsExtensions": true` — imports **must** include the `.ts`
  extension: `import { run } from "../core/exec.ts"`.
- `"strict": true`, `"noEmit": true`, `"jsx": "react-jsx"`.

## `vite.config.ts`

- Frontend root is `web/`, build output is `dist/`.
- Vite dev server on port **4748**, proxying `/api` → `http://127.0.0.1:4747`.
- The API server (TASK 09) owns port **4747**.

---

## `core/types.ts` — all type contracts

Read this file in full before writing code. Summary of what it exports:

### Data shapes

- `ProjectKind = "repo" | "worktree" | "submodule" | "orphan"`
  - `repo` — a normal checkout (`.git` is a directory)
  - `worktree` — a linked worktree (`.git` file pointing into `…/worktrees/…`)
  - `submodule` — (`.git` file pointing into `…/modules/…`)
  - `orphan` — a directory with a project manifest but **no git at all**
- `ProjectLocation` — `path`, `relPath`, `name`, `group`, `nestedIn`, `depth`
- `ProjectFacts extends ProjectLocation` — adds `id`, `kind`, and a large set of
  **optional** fields grouped by the probe that fills them. Every probe-supplied
  field is optional on purpose: absent data must stay `undefined`, never be
  faked as `0` or `""`.
- `Flag` — `{ rule, severity, label, detail? }`
- `FlagSeverity = "critical" | "warn" | "info" | "good"`
- `ProjectStatus = "active" | "obsolete" | "archived" | "unknown"`
- `Annotation` — `{ status, note, snoozedUntil, updatedAt, lastSeenAt? }`
- `Project extends ProjectFacts` — adds `annotation`, `flags`, `risk`, `suppressed`
- `Inventory` — `{ root, scannedAt, fetched, durationMs, projects, probes, rules, actions }`

### Extension point interfaces

```ts
interface ProbeContext {
  path: string;                    // absolute path of the project
  facts: ProjectFacts;             // facts accumulated by earlier probes
  root: string;                    // absolute scan root
  fetch: boolean;                  // is this scan allowed to hit the network
  run: (cmd: string, args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
  pruneDirs: Set<string>;
}

interface Probe {
  name: string;
  order?: number;                              // lower runs first, default 100
  appliesTo?: (facts: ProjectFacts) => boolean; // skip when false
  detect: (ctx: ProbeContext) => Promise<Partial<ProjectFacts> | void>;
}

interface Rule {
  name: string;
  severity: FlagSeverity;
  label: string;
  when: (facts: ProjectFacts, annotation: Annotation) => boolean | string;
  alwaysApply?: boolean;   // fire even when snoozed/obsolete/archived
}

interface Action {
  name: string;
  label: string;
  description: string;
  appliesTo: (project: Project) => boolean;
  script: (project: Project, root: string) => string[];
}
```

`ctx.run` already runs in the project directory — **do not pass a cwd**.
`when` returning a **string** means "flag fires, and use this string as
`Flag.detail`". Returning `true` means "fires, no detail". `false` means "does
not fire".

### Constant

```ts
const SEVERITY_RANK: Record<FlagSeverity, number> = { critical: 3, warn: 2, info: 1, good: 0 };
```

---

## `core/config.ts`

```ts
interface Config {
  root: string;          // absolute, default `~/code`
  maxDepth: number;      // default 5
  pruneDirs: string[];   // never descended into
  ignore: string[];      // relPath prefixes skipped entirely, default []
  staleDays: number;     // default 180
  abandonedDays: number; // default 365
  scratchDirs: string[]; // default ["tmp","test","scratch","sandbox","playground"]
  port: number;          // default 4747
}

async function loadConfig(dir: string): Promise<Config>
const DISPOSABLE_DIRS: Set<string>
```

`loadConfig(dir)` reads `inventory.config.json` from `dir` if present and merges
it over the defaults. `dir` is the repo-inventory root.

`pruneDirs` contains ~30 names including `node_modules`, `.git`, `.venv`, `dist`,
`build`, `target`, `bin`, `obj`, `Pods`, `DerivedData`, `.idea`, `vendor`,
`coverage`. `DISPOSABLE_DIRS` is the subset that is pure build/dependency output
and therefore safe to report as reclaimable disk space.

---

## `core/exec.ts`

```ts
interface RunResult { ok: boolean; stdout: string; stderr: string }

function run(cwd: string, cmd: string, args: string[], timeoutMs = 15_000): Promise<RunResult>
function git(cwd: string, args: string[], timeoutMs?: number): Promise<string | null>
function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]>
```

- `run` **never rejects**. Failure is reported as `ok: false`. A messy folder
  constantly produces expected failures (empty repo, no upstream), so those are
  return values rather than exceptions.
- `run` hardens the environment so a scan can never hang on a credential or
  SSH host-key prompt: `GIT_TERMINAL_PROMPT=0`, batch-mode SSH,
  `GIT_OPTIONAL_LOCKS=0`.
- `git` returns trimmed stdout, or `null` if the command failed.
- `mapLimit` bounds concurrency. Use it whenever you iterate projects.

---

## `core/discover.ts`

```ts
function projectId(remoteUrl: string | null | undefined, relPath: string): string
function discover(config: Config): Promise<ProjectFacts[]>
function measureFootprint(
  dir: string,
  prune: Set<string>,
  disposable: Set<string>,
): Promise<{ sourceBytes: number; disposableBytes: number; sourceFiles: number }>
```

### `projectId`

- With a remote URL: `remote:<normalized-url>` — scheme, `git@`, `.git` suffix
  and trailing slashes stripped, `:` turned into `/`, lowercased. So
  `git@github.com:me/x.git` and `https://github.com/me/x` produce the same id.
- Without a remote: `path:<sha1(relPath) first 12 hex chars>`.

Consequence: a repo **with** a remote keeps its annotations when moved out of
`tmp/`. A repo **without** a remote does not. That is intentional and honest —
there is nothing intrinsic to track it by.

### `discover`

Walks `config.root`, pruning `config.pruneDirs`, to `config.maxDepth`. A
directory becomes a candidate if it contains `.git` **or** a recognised manifest
(`package.json`, `pyproject.toml`, `*.csproj`, `go.mod`, `Cargo.toml`,
`pom.xml`, `Package.swift`, `Dockerfile`, `docker-compose.yml`, `Makefile`, and
~20 more).

Then:

- It **descends into repositories** rather than stopping at them, so a nested
  checkout is found and gets `nestedIn` set to the parent's `relPath`.
- A manifest **inside** a repo is not a separate project — it is stack
  information for that repo, and is dropped.
- Sub-packages of an untracked project are collapsed into the topmost one.
- `.git` as a *file* is resolved to `worktree` or `submodule`.

Returns `ProjectFacts[]` with these fields populated and nothing else:
`id` (path-based placeholder), `kind`, `path`, `relPath`, `name`, `group`,
`nestedIn`, `depth`, `isGit`, `manifests`.

`id` is a placeholder here; `probes/10-git-basics.ts` overwrites it once it knows
the remote URL.

### `measureFootprint`

Recursive size walk. Directories in `disposable` are summed into
`disposableBytes` and not descended for source; directories in `prune` are
skipped; everything else contributes to `sourceBytes`/`sourceFiles`.

**TASK 04 extends this function's return type** — see that task.

---

## `core/state.ts`

```ts
function defaultAnnotation(): Annotation   // { status:"unknown", note:"", snoozedUntil:null, updatedAt:"" }

class AnnotationStore {
  static open(dir: string): Promise<AnnotationStore>   // reads <dir>/data/annotations.json
  reload(): Promise<void>
  get(id: string): Annotation                          // never throws, returns default if absent
  all(): Record<string, Annotation>
  update(id: string, patch: Partial<Pick<Annotation,"status"|"note"|"snoozedUntil"|"lastSeenAt">>): Promise<Annotation>
  touchSeen(entries: Array<{ id: string; relPath: string }>): Promise<void>
  orphans(knownIds: Set<string>): Array<{ id: string; annotation: Annotation }>
}

function isSnoozed(annotation: Annotation, now?: Date): boolean
const STATUSES: ProjectStatus[]   // ["unknown","active","obsolete","archived"]
```

- Writes are serialised through an internal promise queue, so two concurrent
  dashboard clicks cannot interleave a read-modify-write.
- Writes are atomic (`write to .tmp` then `rename`), so a crash cannot truncate
  the user's decisions.
- An annotation that returns to all-defaults is **deleted** rather than stored,
  keeping the file small and meaningful.

---

## `core/registry.ts`

```ts
interface Registry { probes: Probe[]; rules: Rule[]; actions: Action[] }
function loadRegistry(baseDir: string): Promise<Registry>
```

Reads `<baseDir>/probes`, `<baseDir>/rules`, `<baseDir>/actions`; imports every
`.ts` file in sorted filename order; harvests exports `probe`/`probes`,
`rule`/`rules`, `action`/`actions`. Missing directories are fine (empty array).
`probes` are then sorted by `order ?? 100`.

---

## `probes/10-git-basics.ts`

Already written. `order: 0`, `appliesTo: facts => facts.isGit === true`.

Produces: `id` (recomputed from remote URL), `branch` (`null` when detached),
`detached`, `branchCount`, `hasRemote`, `remoteName`, `remoteUrl`, `remoteHost`,
`defaultBranch`, `extra.gitPath`, `extra.remotes`.

Notes worth copying in your own probes:

- It does not assume the remote is called `origin`; it falls back to the first
  remote that exists.
- It writes `branch: null` and `detached: true` when `rev-parse --abbrev-ref HEAD`
  returns the literal `HEAD`.

---

## What does not exist yet

`core/scan.ts`, `core/report.ts`, `probes/15|20|30|40|50|60`, `rules/`,
`actions/`, `server/`, `web/`, `bin/`, `data/`, `node_modules`, `.gitignore`,
`README.md`.

Nothing has been installed and nothing has been run yet. TASK 03 does that.
