# TASK 06 — The scan pipeline

**Goal:** `core/scan.ts` — one module that turns a folder on disk into an
`Inventory` object and writes it to `data/inventory.json`.

**File you create:** `core/scan.ts`

**Files you must not touch:** everything else.

---

## Public API — implement exactly this

```ts
import type { Inventory, Project, ProjectFacts, Flag, Annotation } from "./types.ts";

export interface ScanOptions {
  /** Absolute path of the repo-inventory installation. Used to find config, plugins and data/. */
  baseDir: string;
  /** Contact remotes so ahead/behind is fresh. Default false. */
  fetch?: boolean;
  /** Called after each project completes, for CLI progress output. */
  onProgress?: (done: number, total: number, relPath: string) => void;
}

/** Runs a full scan and writes data/inventory.json. */
export async function scan(options: ScanOptions): Promise<Inventory>;

/** Reads the last scan from disk. Returns null when there is none. */
export async function readInventory(baseDir: string): Promise<Inventory | null>;

/**
 * Recomputes flags and re-merges annotations over already-collected facts.
 * No filesystem or git access. Used when an annotation changes.
 */
export async function refresh(baseDir: string, inventory: Inventory): Promise<Inventory>;
```

`refresh` exists because changing a status must not cost a 15-second rescan.
Facts are expensive; flags are free. Keep that split.

---

## Implementation

### Imports

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { discover } from "./discover.ts";
import { loadRegistry } from "./registry.ts";
import { run, mapLimit } from "./exec.ts";
import { AnnotationStore, defaultAnnotation, isSnoozed } from "./state.ts";
import { SEVERITY_RANK } from "./types.ts";
import type { /* … */ } from "./types.ts";
```

### `scan` — step by step

1. Record `const startedAt = Date.now()`.
2. `const config = await loadConfig(options.baseDir)`.
3. `const registry = await loadRegistry(options.baseDir)`.
4. `const store = await AnnotationStore.open(options.baseDir)`.
5. `const discovered = await discover(config)`.
6. `const pruneDirs = new Set(config.pruneDirs)`.
7. Run probes over projects with **bounded concurrency of 8**:

   ```ts
   let done = 0;
   const facts = await mapLimit(discovered, 8, async (initial) => {
     let merged: ProjectFacts = { ...initial };
     const errors: string[] = [];

     for (const probe of registry.probes) {
       if (probe.appliesTo && !probe.appliesTo(merged)) continue;
       try {
         const produced = await probe.detect({
           path: merged.path,
           facts: merged,
           root: config.root,
           fetch: options.fetch === true,
           run: (cmd, args) => run(merged.path, cmd, args),
           pruneDirs,
         });
         if (produced) merged = { ...merged, ...produced };
       } catch (error) {
         errors.push(`${probe.name}: ${error instanceof Error ? error.message : String(error)}`);
       }
     }

     if (errors.length > 0) merged.extra = { ...merged.extra, probeErrors: errors };
     done += 1;
     options.onProgress?.(done, discovered.length, merged.relPath);
     return merged;
   });
   ```

   Note: the probe loop inside one project is **sequential**, because each probe
   sees the facts the previous ones established. Only the outer project loop is
   concurrent.

8. Deduplicate ids. Two checkouts of the same remote produce the same
   `projectId`, and a worktree plus its main repo certainly will. The `id` must be
   unique because the dashboard and the annotation store key on it. Resolve by
   suffixing collisions with the relPath hash:

   ```ts
   const seen = new Set<string>();
   for (const project of facts) {
     if (!seen.has(project.id)) { seen.add(project.id); continue; }
     project.id = `${project.id}#${project.relPath}`;
     seen.add(project.id);
   }
   ```

   Deterministic, so annotations stay attached across scans as long as the paths
   do not change. Iterate in `relPath` order (which `discover` already returns) so
   the first occurrence keeps the clean id.

9. `await store.touchSeen(facts.map(f => ({ id: f.id, relPath: f.relPath })))`.
10. Build `Project[]` via the shared `evaluate` helper below.
11. Assemble the `Inventory`:

    ```ts
    const inventory: Inventory = {
      root: config.root,
      scannedAt: new Date().toISOString(),
      fetched: options.fetch === true,
      durationMs: Date.now() - startedAt,
      projects,
      probes: registry.probes.map((p) => p.name),
      rules: registry.rules.map((r) => ({
        name: r.name, severity: r.severity, label: r.label, alwaysApply: r.alwaysApply === true,
      })),
      actions: registry.actions.map((a) => ({
        name: a.name, label: a.label, description: a.description,
      })),
    };
    ```

12. Write it, atomically, to `<baseDir>/data/inventory.json`: `mkdir` the `data`
    directory with `{ recursive: true }`, write to `inventory.json.tmp`, then
    `rename`. Same reason as in `core/state.ts` — a half-written file must never
    be readable.
13. Sort `projects` before writing: descending `risk`, then ascending `relPath`.
    The most alarming project must be first with no client-side work.
14. Return the inventory.

### The `evaluate` helper — used by both `scan` and `refresh`

```ts
function evaluate(facts: ProjectFacts, annotation: Annotation, rules: Rule[]): Project
```

1. `const snoozed = isSnoozed(annotation)`.
2. `const dimmed = snoozed || annotation.status === "obsolete" || annotation.status === "archived"`.
3. For each rule, in array order:
   - `const verdict = rule.when(facts, annotation)` — wrap in try/catch; on throw,
     skip the rule and append to a local error list.
   - Skip when `verdict === false`.
   - When `dimmed === true` and `rule.alwaysApply !== true`, skip it.
   - Otherwise push `{ rule: rule.name, severity: rule.severity, label: rule.label, detail: typeof verdict === "string" ? verdict : undefined }`.
4. If any rule threw, append one extra flag:
   `{ rule: "RULE_ERROR", severity: "info", label: "Rule evaluation failed", detail: <joined messages> }`.
5. If `facts.extra?.probeErrors` is a non-empty array, append
   `{ rule: "PROBE_ERROR", severity: "info", label: "Probe failed", detail: <joined> }`.
6. `risk` = the highest `SEVERITY_RANK[flag.severity]` among the flags, or `0`
   when there are none. `good` ranks 0, so a healthy project scores 0 — correct.
7. Return `{ ...facts, annotation, flags, risk, suppressed: dimmed }`.

Why suppression happens here and not in the rules: a rule stays a simple
predicate about facts, and the policy of "hide noise for things I have already
triaged" lives in one place.

### `readInventory`

Read `<baseDir>/data/inventory.json`, `JSON.parse`, return it. On any failure
(missing, malformed) return `null`. Do not throw.

Validate minimally before returning: it must be a non-null object with an array
`projects`. Otherwise return `null`.

### `refresh`

1. `const registry = await loadRegistry(baseDir)` — picks up rule edits without a
   rescan.
2. `const store = await AnnotationStore.open(baseDir)`.
3. Re-run `evaluate` for every project in `inventory.projects`, using the current
   annotation from the store and stripping the old `annotation`/`flags`/`risk`/
   `suppressed` fields off the facts first.
4. Re-sort the same way as `scan`.
5. Return a new `Inventory` with the original `scannedAt`, `fetched` and
   `durationMs` preserved. Those describe the **facts**, which have not changed —
   overwriting them would lie to the user about how fresh the data is.
6. Do **not** write to disk. `refresh` is a pure view recomputation.

---

## Verification

```bash
cd /path/to/repo-inventory
npm run typecheck
```

Then, because `bin/inventory.ts` does not exist yet, drive it directly:

```bash
cat > /tmp/smoke-scan.ts <<'EOF'
const BASE = "/path/to/repo-inventory";
const { scan } = await import(`${BASE}/core/scan.ts`);
const inv = await scan({ baseDir: BASE, onProgress: (d, t) => { if (d % 10 === 0) console.error(`${d}/${t}`); } });
console.log("projects:", inv.projects.length, "ms:", inv.durationMs);
console.log("ids unique:", new Set(inv.projects.map((p) => p.id)).size === inv.projects.length);
const counts: Record<string, number> = {};
for (const p of inv.projects) for (const f of p.flags) counts[f.rule] = (counts[f.rule] ?? 0) + 1;
console.log(counts);
console.log("top 5 risk:");
for (const p of inv.projects.slice(0, 5)) console.log(" ", p.risk, p.relPath, p.flags.map((f) => f.rule).join(","));
EOF
node /tmp/smoke-scan.ts
rm /tmp/smoke-scan.ts
```

Checklist:

- [ ] `npm run typecheck` clean
- [ ] `projects:` is at least 50
- [ ] `ms:` is under 20000
- [ ] `ids unique: true`
- [ ] `counts.LOCAL_ONLY` is between 30 and 45 — this matches the survey finding of
      38 remote-less repos, so a wildly different number means a bug
- [ ] `counts.HEALTHY` is at least 1
- [ ] The top-5 list is sorted by descending `risk` and the first entry has
      `risk: 3`
- [ ] `data/inventory.json` exists and `jq '.projects | length' data/inventory.json`
      matches the printed count
- [ ] `data/inventory.json.tmp` does **not** exist afterwards
- [ ] `/tmp/smoke-scan.ts` deleted

## Report back

`projects`, `durationMs`, the full flag-count object, and the top-5 risk list.
