# TASK 03 — Install and bootstrap

**Goal:** dependencies installed, supporting files created, `npm run typecheck`
passing on the existing code.

**Files you create:**

- `.gitignore`
- `data/.gitkeep`

**Files you must not touch:** everything else.

---

## Step 1 — install

```bash
cd /path/to/repo-inventory
npm install
```

If a listed version does not exist, install the nearest existing minor of the
**same major** version. Do not change majors. Do not add packages.

## Step 2 — create `.gitignore`

```gitignore
node_modules/
dist/
data/inventory.json
data/*.tmp
.DS_Store
*.log
```

`data/annotations.json` is local application state and is intentionally ignored
for public checkouts because it can contain private project names, paths, notes,
and workspace decisions. Preserve it separately when moving a local checkout.

## Step 3 — create `data/.gitkeep`

Empty file. The `data/` directory must exist before the first scan.

## Step 4 — typecheck

```bash
npm run typecheck
```

Expect **zero errors**. If you see errors, they are in the pre-existing code and
you must fix them minimally, without changing behaviour or deleting comments.
Likely candidates and their correct fixes:

| Error | Fix |
|---|---|
| Cannot find module `react` / `vite` types | dependency install incomplete — rerun `npm install` |
| `Cannot find name '__dirname'` | not used anywhere; if you see it, it is your own code |
| Unused import in a written file | remove only the unused specifier |

Do **not** silence errors with `any`, `@ts-ignore`, or by loosening
`tsconfig.json`.

## Step 5 — smoke-test the walker

Create a throwaway file, run it, then **delete it**:

```bash
cat > /tmp/smoke-discover.ts <<'EOF'
import { loadConfig } from "/path/to/repo-inventory/core/config.ts";
import { discover } from "/path/to/repo-inventory/core/discover.ts";

const config = await loadConfig("/path/to/repo-inventory");
const projects = await discover(config);
const byKind: Record<string, number> = {};
for (const p of projects) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
console.log("total", projects.length, byKind);
console.log(projects.filter((p) => p.nestedIn).map((p) => `${p.relPath} <- ${p.nestedIn}`));
console.log(projects.filter((p) => p.kind === "orphan").map((p) => p.relPath));
EOF
node /tmp/smoke-discover.ts
rm /tmp/smoke-discover.ts
```

## Verification — all must hold

- [ ] `npm run typecheck` prints no errors
- [ ] `node_modules/` exists
- [ ] `data/.gitkeep` exists
- [ ] `.gitignore` exists with the six lines above
- [ ] The smoke test prints a **total of at least 50** projects
- [ ] `byKind.repo` is roughly **50** and `byKind.worktree` is at least **1**
      (`tmp/studio_resco.worktrees/...`)
- [ ] The nested list includes `personal/LinkedInWriter/linkedin_workflow <- personal/LinkedInWriter`
- [ ] The smoke test finishes in under 30 seconds
- [ ] `/tmp/smoke-discover.ts` has been deleted

## Report back

State: dependency versions actually installed, the total project count, the
`byKind` breakdown, and the list of orphan `relPath`s. The orphan list is new
information the user has never seen — include it verbatim.
