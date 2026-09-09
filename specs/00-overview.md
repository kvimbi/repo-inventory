# 00 — Overview

## The problem

`/path/to/code` holds every repository and scratch project the user
owns. A survey found:

- 16 top-level folders, **53 git repositories**, ~300 project manifest files
- **38 of 53 repositories have no git remote at all** — the work exists on this
  laptop only. This is the single biggest risk in the folder.
- **21 repositories live under `tmp/`**. Side projects start there and are meant
  to "graduate" into a permanent home, but nobody ever moves them.
- Repositories nested inside other repositories, e.g.
  `personal/LinkedInWriter/linkedin_workflow`
- Linked git worktrees that look like separate repos but are not, e.g.
  `tmp/studio_resco.worktrees/agents-connection-selector-header-integration`

The user cannot answer basic questions: what is here, what is at risk of being
lost, what is dead, what should be moved out of `tmp/`.

## What we are building

A local web dashboard, backed by a pluggable scanner, that answers those
questions and lets the user record decisions.

Off-the-shelf tools were evaluated and rejected as partial fits: `gita` shows
multi-repo git status but knows nothing about tech stack, untracked folders, or
user annotations; `onefetch` works one repo at a time; Backstage-class service
catalogs are absurd overkill. `gita` is installed separately for ad-hoc CLI use
and is **not** part of this codebase.

## Architecture

Three kinds of data, deliberately kept in separate places. This separation is
the most important idea in the codebase — do not blur it.

```
                  ┌──────────────────────────────────────────┐
                  │ FACTS       observed from disk           │
                  │             recomputed every scan        │
                  │             never hand-edited            │
                  │             → data/inventory.json        │
                  └──────────────────────────────────────────┘
                                     +
                  ┌──────────────────────────────────────────┐
                  │ ANNOTATIONS authored by the user in the  │
                  │             dashboard: status, note,     │
                  │             snooze. Survives scans.      │
                  │             → data/annotations.json      │
                  └──────────────────────────────────────────┘
                                     ↓
                  ┌──────────────────────────────────────────┐
                  │ FLAGS       derived by pure rule         │
                  │             functions from facts +       │
                  │             annotations. Never stored    │
                  │             as truth, always recomputed. │
                  └──────────────────────────────────────────┘
```

Why it matters: a scan must be safe to run at any time. If facts and annotations
shared a file, a scan could destroy the user's decisions. If flags were stored,
changing a threshold would require a rescan of 53 repos instead of a reload.

## Directory layout

```
repo-inventory/
├── package.json            written
├── tsconfig.json           written
├── vite.config.ts          written
├── core/
│   ├── types.ts            written — ALL type contracts live here
│   ├── config.ts           written — config + defaults + prune lists
│   ├── exec.ts             written — safe subprocess + concurrency helper
│   ├── discover.ts         written — filesystem walk, project identity
│   ├── state.ts            written — annotation persistence
│   ├── registry.ts         written — plugin loader
│   ├── scan.ts             TASK 06 — the pipeline
│   └── report.ts           TASK 07 — markdown renderer
├── probes/                 plugin dir: collect facts
│   ├── 10-git-basics.ts    written
│   ├── 15-git-fetch.ts     TASK 04
│   ├── 20-git-sync.ts      TASK 04
│   ├── 30-git-activity.ts  TASK 04
│   ├── 40-stack.ts         TASK 04
│   ├── 50-agent-tooling.ts TASK 04
│   └── 60-footprint.ts     TASK 04
├── rules/                  plugin dir: derive flags
│   └── 00-default.ts       TASK 05
├── actions/                plugin dir: emit dry-run shell scripts
│   ├── 10-publish.ts       TASK 08
│   ├── 20-graduate.ts      TASK 08
│   ├── 30-archive.ts       TASK 08
│   └── 40-reclaim-space.ts TASK 08
├── server/
│   └── index.ts            TASK 09 — Fastify API
├── web/                    TASKS 11–14 — React dashboard
├── bin/
│   └── inventory.ts        TASK 10 — CLI entry point
├── data/                   generated at runtime, gitignored except annotations
│   ├── inventory.json      scan output (facts)
│   └── annotations.json    user decisions — the only precious file
└── specs/                  these documents
```

## Data flow of a scan

```
loadConfig()          core/config.ts    → Config
loadRegistry()        core/registry.ts  → { probes, rules, actions }
discover(config)      core/discover.ts  → ProjectFacts[]   (paths, kind, nesting)
  for each project, for each probe in order:
    probe.detect(ctx) → Partial<ProjectFacts>, shallow-merged into facts
applyRules()          core/scan.ts      → Flag[] per project, risk score
merge annotations     core/state.ts     → Project[]
write data/inventory.json
```

Probes run **in filename order** (`10-` before `20-`) because later probes rely
on facts earlier ones established. In particular `10-git-basics` computes the
project `id`, and everything downstream is keyed on it.

## The plugin model

Adding a check must be a one-file change. `core/registry.ts` reads the `probes/`,
`rules/` and `actions/` directories, imports every `.ts` file, and harvests
exports named `probe`/`probes`, `rule`/`rules`, `action`/`actions`. There is no
central registration list to update.

## Non-goals

- **The tool never modifies a repository.** Not `git init`, not `git push`, not
  `rm -rf`. Actions produce shell script *text* that the user reads and runs
  themselves. This is a deliberate constraint chosen by the user.
- No authentication, no multi-user, no remote hosting. It binds to `127.0.0.1`.
- No database. Two JSON files are enough for 53 projects.
- No git history rewriting, no dependency auditing, no CI integration.

## Settled decisions — do not revisit

These were decided explicitly. If an instruction in a task file seems to leave
one open, it does not.

### Identity of a repo with no remote

`core/discover.ts` gives a remote-less project an id of `path:<sha1(relPath)>`.
Consequence: moving such a project out of `tmp/` **loses its annotations**.

The obvious fix — writing a marker file (`.repo-inventory-id`) into each project
— is **rejected**. The tool does not put files into the user's repositories.
A future version may reconcile moves by matching on the first commit hash,
project name and stack, but that is out of scope. Do not implement it, and do not
add marker files.

`AnnotationStore.orphans()` already exists so an abandoned annotation is at least
visible rather than silently dropped, and `Annotation.lastSeenAt` records where
the project last lived.

### `archive` refuses to run on unsaved work

The `archive` action emits a `# SKIPPED` comment block instead of a `tar` + `rm`
pair whenever a project has unpushed commits, uncommitted changes, or no remote.
This is intentional and not an edge case to smooth over. Archiving in those
states would destroy the only copy of the work. The user must run `publish`
first.
