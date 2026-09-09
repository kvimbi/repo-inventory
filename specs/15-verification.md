# TASK 15 — Final verification and README

**Goal:** prove the whole thing works end to end, write the user-facing README,
and hand back a report of what the tool found.

**Files you create:** `README.md`

**Files you may modify:** any file, but **only** to fix a defect you find during
verification. Every fix must be minimal and justified in your report.

---

## Part 1 — Full acceptance run

Run these in order from `/path/to/repo-inventory`. Every step
must pass before you move on.

### 1. Static checks

```bash
npm run typecheck
npm run build
```

Zero TypeScript errors. A successful build. No warnings about missing exports.

### 2. Cold start

```bash
rm -f data/inventory.json INVENTORY.md
npm run scan
```

- [ ] A progress line appears and updates
- [ ] The summary prints project count, duration and four severity buckets
- [ ] Duration under 20 s
- [ ] `data/inventory.json` exists, `data/inventory.json.tmp` does not

### 3. Data sanity

```bash
jq '{
  projects: (.projects|length),
  uniqueIds: (.projects|map(.id)|unique|length),
  kinds: (.projects|group_by(.kind)|map({(.[0].kind): length})|add),
  noRemote: (.projects|map(select(.isGit==true and .hasRemote==false))|length),
  nulls: (.projects|map(select(.relPath==null or .id==null))|length),
  nan: (.projects|map(select(.sourceBytes!=null and (.sourceBytes|isnan)))|length)
}' data/inventory.json
```

- [ ] `projects` equals `uniqueIds` — no id collisions survived
- [ ] `kinds.repo` around 50, `kinds.worktree` at least 1
- [ ] `noRemote` between 30 and 45
- [ ] `nulls` and `nan` are both `0`

### 4. Annotation durability — the critical test

The user's decisions must survive a rescan. This is the property the whole
architecture exists to guarantee.

```bash
ID=$(jq -r '.projects[0].id' data/inventory.json)
npm run serve &
sleep 20
curl -s -X POST localhost:4747/api/annotation -H 'content-type: application/json' \
  -d "{\"id\":\"$ID\",\"status\":\"obsolete\",\"note\":\"acceptance test marker\"}" >/dev/null
curl -s -X POST localhost:4747/api/scan -H 'content-type: application/json' -d '{}' >/dev/null
curl -s localhost:4747/api/inventory | jq --arg id "$ID" '.projects[]|select(.id==$id)|{status:.annotation.status, note:.annotation.note, suppressed}'
kill %1
```

- [ ] After a full rescan the status is still `obsolete` and the note intact
- [ ] `suppressed` is `true`

Then clean up the marker:

```bash
npm run serve &
sleep 20
curl -s -X POST localhost:4747/api/annotation -H 'content-type: application/json' \
  -d "{\"id\":\"$ID\",\"status\":\"unknown\",\"note\":\"\",\"snoozedUntil\":null}" >/dev/null
kill %1
jq '.annotations' data/annotations.json
```

- [ ] `data/annotations.json` annotations object is back to `{}`

### 5. Read-only guarantee

The tool must not have touched a single repository. Verify against the user's real
folder:

```bash
cd /path/to/code
for d in tmp/studio_resco personal/rmmt services-nx web-projects-nx; do
  echo "== $d"; git -C "$d" status --porcelain=v1 | head -3; git -C "$d" reflog -3 --date=iso
done
cd repo-inventory
```

- [ ] No reflog entry is dated today from anything other than the user's own work
- [ ] `git status` output is unchanged from before the scan (no new files, no
      modified index)

Also confirm statically:

```bash
grep -rn "checkout\|reset --hard\|git push\|git commit\|rm -rf" core/ probes/ server/ bin/ | grep -v "^\s*//"
```

- [ ] The only matches are inside generated **string literals** in `actions/`, and
      `actions/` is not in the searched list, so ideally there are **zero** matches

### 6. Fetch mode

```bash
npm run scan -- --fetch
```

- [ ] Completes without hanging (may take a few minutes)
- [ ] No credential prompt appears — the hardened env in `core/exec.ts` holds
- [ ] `jq '.fetched' data/inventory.json` is `true`
- [ ] `STALE_REFS` flag count drops compared to the offline scan
- [ ] Projects whose fetch failed carry `extra.fetchError` rather than crashing

### 7. Report

```bash
npm run report
```

- [ ] `INVENTORY.md` regenerated, contains all four required sections
- [ ] No malformed markdown table

### 8. Dashboard walkthrough

```bash
npm run serve &
sleep 20
```

Open <http://127.0.0.1:4747> and confirm the complete loop:

- [ ] Header shows root, count, timestamp, staleness state
- [ ] Summary cards filter the table when clicked
- [ ] Text search, group, status, stack and flag filters all narrow correctly and
      combine with AND
- [ ] Every sortable column sorts both ways, nulls always last
- [ ] Row click opens the detail drawer with flags, annotation editor and facts
- [ ] Marking `obsolete` updates the row instantly; `LOCAL_ONLY` / `UNPUSHED_WORK`
      stay visible
- [ ] A note persists across a page reload
- [ ] Snooze hides non-critical flags and shows the "hidden until" line
- [ ] Multi-select plus an action produces a reviewable script, with `skipped`
      reported honestly
- [ ] Rescan from the UI works and clears the selection
- [ ] No console errors anywhere in the walkthrough

Then `kill %1`.

### 9. Plugin extensibility proof

The plugin claim must be real, not aspirational. Verify by adding a rule, checking
it appears, then **deleting it**:

```bash
cat > rules/99-temp-proof.ts <<'EOF'
import type { Rule } from "../core/types.ts";

export const rule: Rule = {
  name: "PROOF",
  severity: "info",
  label: "Plugin loading works",
  when: (facts) => facts.name.length > 3,
};
EOF
npm run scan | tail -8
jq '[.projects[].flags[]|select(.rule=="PROOF")]|length' data/inventory.json
rm rules/99-temp-proof.ts
npm run scan >/dev/null
jq '[.projects[].flags[]|select(.rule=="PROOF")]|length' data/inventory.json
```

- [ ] The first count is greater than 0 — the rule was picked up with no
      registration anywhere
- [ ] The second count is `0` — removing the file removes the rule
- [ ] `rules/99-temp-proof.ts` is deleted

---

## Part 2 — `README.md`

Write it for the user, not for an agent. Terse, no marketing. Required sections:

### `# repo-inventory`

Two sentences: what it does, and the read-only guarantee.

### `## Quick start`

```bash
npm install
npm run build
npm run serve      # http://127.0.0.1:4747
```

### `## Commands`

The table of the four CLI commands with one-line descriptions, plus a note that
`--fetch` is the only thing that touches the network.

### `## What it looks at`

One paragraph plus the flag table: rule name, severity, meaning. Generate the rows
from the actual loaded rules so it cannot drift:

```bash
node --input-type=module -e '
  const { loadRegistry } = await import("./core/registry.ts");
  const { rules } = await loadRegistry(process.cwd());
  for (const r of rules) console.log(`| \`${r.name}\` | ${r.severity} | ${r.label} |`);
'
```

### `## Your decisions`

Explain the two data files in plain terms:

- `data/inventory.json` — regenerated by every scan, disposable, gitignored
- `data/annotations.json` — your status, notes and snoozes; local/private state,
  gitignored for public checkouts and preserved separately

State plainly that a snooze or an `obsolete` status hides noise but never hides
`UNPUSHED_WORK`, `LOCAL_ONLY`, `NOT_VERSIONED` or `UNCOMMITTED_AND_ABANDONED`.

### `## Actions are never executed`

Explain that actions emit shell script text, that the user reviews and runs it,
and that no module under `actions/` can perform side effects by construction.

### `## Extending it`

Three short subsections with a complete copy-pasteable example each: a probe, a
rule, an action. Point at the `probes/`, `rules/`, `actions/` directories and the
filename-ordering convention.

### `## Configuration`

Document `inventory.config.json` with every `Config` field, its default, and what
it affects.

### `## Related tools`

One line: `gita` is installed separately for ad-hoc multi-repo git commands
(`gita ll`, `gita fetch -a`) and is not part of this tool.

---

## Report back

This is the report the user reads. Include:

1. **Pass/fail for every checkbox above.** Name anything that failed and what you
   changed to fix it.
2. **The findings.** The `## Summary` table from `INVENTORY.md`, verbatim.
3. **The top 10 riskiest projects**, with their flags — this is the answer to the
   question the user originally asked.
4. **Every project with `UNPUSHED_WORK` or `UNCOMMITTED_AND_ABANDONED`.** These are
   at risk of real data loss and the user should act today.
5. **The full `NOT_VERSIONED` list** — code with no git repository at all.
6. **The `SCRATCH_BUT_ACTIVE` list** — the projects that have earned their way out
   of `tmp/`.
7. **Total reclaimable disk space.**
8. **Anything the specs got wrong.** If a spec instruction was impossible,
   ambiguous or produced a bad result, say so plainly. Do not paper over it.
