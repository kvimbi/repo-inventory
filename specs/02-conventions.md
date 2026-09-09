# 02 — Conventions and hard constraints

Violating anything in this file will break the build. Read it once, carefully.

## Runtime

Node **v26**. It executes `.ts` files directly by **stripping types**. There is
no compiler step for backend code. Consequences:

### Forbidden TypeScript syntax

Type stripping can only remove syntax; it cannot generate code. These are
**compile errors** in this project (`erasableSyntaxOnly: true`):

| Forbidden | Use instead |
|---|---|
| `enum Foo { A, B }` | `const FOO = ["a","b"] as const` + `type Foo = typeof FOO[number]` |
| `namespace Foo {}` | a module file |
| `constructor(private x: string) {}` | declare the field, assign in the body |
| `declare function f(): void` in a `.ts` file | a real implementation or a `.d.ts` |
| `export = x` / `import x = require()` | `export default` / `import` |

### Required import style

```ts
// ✅ correct — extension included, type-only import marked
import type { Probe, ProjectFacts } from "../core/types.ts";
import { run, mapLimit } from "../core/exec.ts";

// ❌ wrong — no extension, Node cannot resolve it
import type { Probe } from "../core/types";

// ❌ wrong — verbatimModuleSyntax forbids mixing a type into a value import
import { Probe, run } from "../core/exec.ts";
```

Frontend files under `web/` are bundled by Vite, so `.ts`/`.tsx` extensions on
imports are still required for consistency — **write them everywhere**.

## Style rules

1. **Comments explain *why*, never *what*.** No comment that restates the code.
   ```ts
   // ❌ increment the counter
   count++;

   // ✅ `git status` reports staged and unstaged separately; collapse them
   //    because the user only cares that work is uncommitted.
   ```
2. **No dead code, no `TODO`, no commented-out blocks.** If it is not needed,
   do not write it.
3. **No `any`.** Use `unknown` and narrow. If a JSON parse gives you `unknown`,
   guard it before use.
4. **Absent data is `undefined`, not `0` or `""`.** A repo with no commits must
   report `lastCommitAt: null`, never a fake date. A probe that cannot determine
   something returns nothing for that field.
5. **Never let a probe throw.** Use `ctx.run` (which cannot reject) and guard all
   parsing. One bad repo must not abort the scan.
6. **Name things after the domain**, not the mechanism: `lastCommitAgeDays`, not
   `daysDiff`.
7. **Functions do one thing.** If a function needs a section comment to separate
   its halves, it is two functions.
8. **No emoji in source files.** Severity is expressed with the `FlagSeverity`
   union, not with symbols. (The web UI may use coloured dots via CSS.)
9. **Never annotate a React component's return type.** React 19 removed the
   global `JSX` namespace, so `: JSX.Element` is a compile error. Let it be
   inferred:
   ```tsx
   // ✅
   export function SummaryBar(props: SummaryBarProps) { … }

   // ❌ "Cannot find namespace 'JSX'"
   export function SummaryBar(props: SummaryBarProps): JSX.Element { … }
   ```
   Where the web task specs show `: JSX.Element` in a signature, that is
   shorthand for "this is a component" — do not write it in the code.

## Git safety rules — non-negotiable

This tool inspects the user's real work. Data loss is unacceptable.

- Use read-only Git commands for inspection: `rev-parse`, `rev-list`,
  `for-each-ref`, `status`, `log`, `remote`, `stash list`, `symbolic-ref`,
  `config --get`, `count-objects`, `worktree list`, and `fetch` (only guarded by
  `ctx.fetch`, only with `--prune --quiet`).
- Semantic commits are allowed when explicitly requested. Stage only the
  intended files, verify each staged diff with `git diff --cached --check`, and
  never include secrets or generated runtime state.
- An explicitly requested `merge` is allowed after inspecting the complete
  worktree and branch topology. Preserve unrelated local changes, stop for
  conflicts, and never discard or auto-resolve user work.
- **Never** run `checkout`, `reset`, `clean`, `gc`, `push`, `rebase`, `stash
  push`, `branch -d`, or any command that destructively rewrites the working
  tree or history.
- `actions/` modules return **strings**. Nothing in `actions/` may import
  `core/exec.ts` or `node:child_process`. This is the guarantee that generated
  scripts cannot self-execute.
- Generated scripts must be defensive: `set -euo pipefail`, every destructive
  line preceded by a comment naming what it destroys, and no `rm -rf` of
  anything except paths inside `DISPOSABLE_DIRS`.

## Performance rules

- Scanning must stay under ~15 seconds offline for 53 repos.
- Use `mapLimit(projects, 8, …)` for the project loop. Never `Promise.all` over
  all projects — that forks 50+ git processes at once.
- Within one project, independent git commands may be `Promise.all`'d; there are
  only a handful.
- `git fetch` gets a 30 s timeout and only runs when `ctx.fetch` is true.

## Error handling policy

| Situation | Behaviour |
|---|---|
| A single probe fails on a project | Record it, continue. Push a `Flag` with rule `PROBE_ERROR`, severity `info`. |
| `discover` cannot read a directory | Skip it silently (permissions, dangling symlink). |
| `data/inventory.json` missing when the server starts | Run a scan automatically. |
| `data/annotations.json` missing or corrupt | Start from empty. Never crash. |
| Annotation write fails | Return HTTP 500 with the message. Never silently swallow. |

## Verification commands

Available from `/path/to/repo-inventory` after TASK 03:

```bash
npm run typecheck     # tsc --noEmit — must be clean, zero errors
npm run scan          # offline scan, writes data/inventory.json
npm run report        # writes INVENTORY.md
npm run serve         # API + dashboard on http://127.0.0.1:4747
npm run dev           # API + Vite dev server with HMR on :4748
```

`npm run typecheck` must pass with **zero errors** at the end of every task.
This is the primary gate. Run it before you declare anything finished.
