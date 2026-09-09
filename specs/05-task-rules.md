# TASK 05 — Rules: derive the risk flags

**Goal:** one file exporting the default rule set. Rules turn raw facts into the
short list of things the user should actually look at.

**File you create:** `rules/00-default.ts`

**Files you must not touch:** everything else.

---

## Shape of the file

```ts
import type { Rule } from "../core/types.ts";

export const rules: Rule[] = [ /* … */ ];
```

Note the **plural** export name — `core/registry.ts` harvests both `rule` and
`rules`.

## Contract recap

```ts
when: (facts: ProjectFacts, annotation: Annotation) => boolean | string
```

- `false` → flag does not fire
- `true` → flag fires with no detail
- a **string** → flag fires and the string becomes `Flag.detail`

Prefer returning a string with the concrete numbers in it. `"3 commits never
pushed"` is useful; a bare label is not.

`alwaysApply: true` means the flag fires even when the project is snoozed,
obsolete or archived. Reserve it for **data-loss risks only** — the user must not
be able to hide the fact that unpushed work exists by marking a project
obsolete.

Thresholds live in `core/config.ts` (`staleDays: 180`, `abandonedDays: 365`,
`scratchDirs`), but rules do **not** receive the config. Hard-code the numbers
`180` and `365`, and detect scratch paths with the helper below. This keeps
`Rule.when` a pure two-argument function.

```ts
const SCRATCH = ["tmp", "test", "scratch", "sandbox", "playground"];
const inScratch = (relPath: string) => SCRATCH.includes(relPath.split("/")[0] ?? "");
```

---

## The rules, in this order

Write them in exactly this order — the dashboard displays flags in array order.

### 1. `UNPUSHED_WORK` — critical, `alwaysApply: true`

Label: `Unpushed commits`

Fires when the project is git, has a remote, and `facts.ahead` is greater than 0.

Detail: `` `${facts.ahead} commit(s) ahead of ${facts.remoteName ?? "remote"}` ``

### 2. `LOCAL_ONLY` — critical, `alwaysApply: true`

Label: `No remote — exists only on this machine`

Fires when `facts.isGit === true` and `facts.hasRemote === false` and
`facts.kind === "repo"`.

Exclude `worktree` and `submodule` kinds: a worktree shares the parent's remote,
so flagging it is a false positive.

Detail: include the commit count when known —
`` `${facts.commitsTotal ?? 0} commits, no remote configured` ``

This rule fires for ~38 of the user's repositories. That is the point.

### 3. `NOT_VERSIONED` — critical, `alwaysApply: true`

Label: `Code with no git repository`

Fires when `facts.kind === "orphan"`.

Detail: `` `${facts.sourceFiles ?? 0} source files, ${(facts.manifests ?? []).join(", ") || "no manifest"}` ``

### 4. `LOCAL_ONLY_BRANCHES` — warn, `alwaysApply: true`

Label: `Branches that exist nowhere else`

Fires when `facts.hasRemote === true` and `facts.localOnlyBranches` has length
greater than 0.

Detail: the branch names joined with `", "`, truncated to the first 5 with
`` `+${n} more` `` appended when there are more.

Only fires when a remote **exists** — otherwise `LOCAL_ONLY` already covers it and
two flags saying the same thing is noise.

### 5. `UNCOMMITTED` — warn

Label: `Uncommitted changes`

Fires when `(facts.dirtyFiles ?? 0) > 0`.

Detail: `` `${facts.dirtyFiles} modified file(s)` `` plus
`` `, ${facts.untrackedFiles} untracked` `` when `untrackedFiles` is over 0.

### 6. `BEHIND_REMOTE` — warn

Label: `Behind remote`

Fires when `(facts.behind ?? 0) > 0` and `(facts.ahead ?? 0) === 0`.

Detail: `` `${facts.behind} commit(s) behind` ``

### 7. `DIVERGED` — warn

Label: `Diverged from remote`

Fires when `(facts.ahead ?? 0) > 0 && (facts.behind ?? 0) > 0`.

Detail: `` `${facts.ahead} ahead, ${facts.behind} behind` ``

### 8. `SCRATCH_BUT_ACTIVE` — warn

Label: `Active project living in a scratch folder`

Fires when `inScratch(facts.relPath)` and `(facts.commits90d ?? 0) >= 5`.

Detail: `` `${facts.commits90d} commits in 90 days, still under ${facts.group}/` ``

This is the "graduate it" signal the user explicitly asked for.

### 9. `NESTED_REPO` — warn

Label: `Repository nested inside another repository`

Fires when `facts.nestedIn !== null`.

Detail: `` `inside ${facts.nestedIn}` ``

### 10. `NO_UPSTREAM` — info

Label: `Current branch has no upstream`

Fires when `facts.noUpstream === true` and `facts.hasRemote === true`.

Detail: `` `branch ${facts.branch ?? "(detached)"} tracks nothing` ``

### 11. `STALE_REFS` — info

Label: `Remote state is stale`

Fires when `facts.hasRemote === true` and `facts.lastFetchAt` is null or older
than 30 days.

Detail: `"never fetched"` when null, otherwise
`` `last fetched ${n} days ago — ahead/behind may be wrong` ``

Honesty rule: the dashboard must not present a stale ahead/behind as fact.

### 12. `STALE` — info

Label: `No commits in 6 months`

Fires when `facts.lastCommitAgeDays` is a number, is `>= 180` and is `< 365`.

Detail: `` `last commit ${facts.lastCommitAgeDays} days ago` ``

### 13. `ABANDONED` — info

Label: `No commits in over a year`

Fires when `(facts.lastCommitAgeDays ?? -1) >= 365`.

Detail: `` `last commit ${facts.lastCommitAgeDays} days ago` ``

### 14. `UNCOMMITTED_AND_ABANDONED` — critical, `alwaysApply: true`

Label: `Uncommitted work in an abandoned project`

Fires when `(facts.dirtyFiles ?? 0) > 0 && (facts.lastCommitAgeDays ?? 0) >= 365`.

Detail: `` `${facts.dirtyFiles} modified file(s) untouched for ${facts.lastCommitAgeDays} days` ``

The combination is much worse than either part: work in flight that was
forgotten. Deliberately overlaps `UNCOMMITTED` and `ABANDONED`.

### 15. `NO_COMMITS` — info

Label: `Repository with no commits`

Fires when `facts.isGit === true && facts.lastCommitAt === null`.

Detail: `"git initialised but nothing committed"`

### 16. `RECLAIMABLE_SPACE` — info

Label: `Large build output`

Fires when `(facts.disposableBytes ?? 0) > 500 * 1024 * 1024`.

Detail: `` `${(facts.disposableBytes / 1024 / 1024 / 1024).toFixed(1)} GB in build and dependency folders` ``

### 17. `NO_README` — info

Label: `No README`

Fires when `facts.hasReadme === false` and `(facts.commitsTotal ?? 0) > 10`.

Only for projects with real history. Flagging a three-commit experiment for
missing documentation is noise.

### 18. `DETACHED_HEAD` — warn

Label: `Detached HEAD`

Fires when `facts.detached === true`.

Detail: `"HEAD is not on a branch"`

### 19. `HEALTHY` — good

Label: `Healthy`

Fires when **all** of these hold:

- `facts.isGit === true`
- `facts.hasRemote === true`
- `(facts.ahead ?? 0) === 0`
- `(facts.behind ?? 0) === 0`
- `(facts.dirtyFiles ?? 0) === 0`
- `(facts.localOnlyBranches ?? []).length === 0`
- `(facts.lastCommitAgeDays ?? 9999) < 180`

Returns `true` with no detail.

Purpose: the dashboard needs a positive state so "no flags" never has to mean
"we did not look".

---

## Guard rails while writing these

- Every rule must be a **pure function**. No `await`, no file access, no `Date`
  arithmetic beyond comparing against `facts.*AgeDays` and `facts.lastFetchAt`.
- Use `?? 0` / `?? -1` defaults so an `undefined` field never produces a false
  positive. Think about which default makes the rule *not* fire.
- Never assume a field exists because a probe usually sets it. Orphans have no
  git fields at all.
- Do not use `enum` (see `02-conventions.md`).

## Verification

```bash
cd /path/to/repo-inventory
npm run typecheck
```

Then this harness (create, run, **delete**):

```bash
cat > /tmp/smoke-rules.ts <<'EOF'
const BASE = "/path/to/repo-inventory";
const { loadRegistry } = await import(`${BASE}/core/registry.ts`);
const { defaultAnnotation } = await import(`${BASE}/core/state.ts`);

const { rules } = await loadRegistry(BASE);
console.log("rule count:", rules.length);
console.log(rules.map((r) => `${r.severity.padEnd(8)} ${r.name}${r.alwaysApply ? " [always]" : ""}`).join("\n"));

const ann = defaultAnnotation();
const cases = {
  localOnlyRepo: { kind: "repo", relPath: "tmp/x", group: "tmp", name: "x", path: "/x", depth: 1, nestedIn: null, id: "a", isGit: true, hasRemote: false, commitsTotal: 12, lastCommitAgeDays: 4, dirtyFiles: 0 },
  orphan:        { kind: "orphan", relPath: "k8s", group: "(root)", name: "k8s", path: "/k", depth: 0, nestedIn: null, id: "b", isGit: false, sourceFiles: 9, manifests: ["Chart.yaml"] },
  healthy:       { kind: "repo", relPath: "services-nx", group: "(root)", name: "s", path: "/s", depth: 0, nestedIn: null, id: "c", isGit: true, hasRemote: true, ahead: 0, behind: 0, dirtyFiles: 0, localOnlyBranches: [], lastCommitAgeDays: 3, lastFetchAt: new Date().toISOString(), hasReadme: true, commitsTotal: 500 },
  forgotten:     { kind: "repo", relPath: "personal/old", group: "personal", name: "old", path: "/o", depth: 1, nestedIn: null, id: "d", isGit: true, hasRemote: true, ahead: 3, behind: 1, dirtyFiles: 7, lastCommitAgeDays: 900, lastFetchAt: null, localOnlyBranches: ["wip"], hasReadme: false, commitsTotal: 40 },
};
for (const [label, facts] of Object.entries(cases)) {
  const fired = rules.filter((r) => r.when(facts as never, ann) !== false).map((r) => r.name);
  console.log(label, "→", fired.join(", ") || "(none)");
}
EOF
node /tmp/smoke-rules.ts
rm /tmp/smoke-rules.ts
```

Checklist:

- [ ] `rule count: 19`
- [ ] `localOnlyRepo` fires `LOCAL_ONLY` and does **not** fire `HEALTHY`
- [ ] `orphan` fires `NOT_VERSIONED` only, and nothing git-related
- [ ] `healthy` fires `HEALTHY` and nothing with severity `critical` or `warn`
- [ ] `forgotten` fires at least `UNPUSHED_WORK`, `DIVERGED`, `UNCOMMITTED`,
      `ABANDONED`, `UNCOMMITTED_AND_ABANDONED`, `STALE_REFS`, `LOCAL_ONLY_BRANCHES`
- [ ] No rule throws on the `orphan` case — this is the main trap, since it has no
      git fields at all
- [ ] `/tmp/smoke-rules.ts` deleted

## Report back

The rule table printed by the harness and the four `→` lines.
