# repo-inventory — implementation specs

You are implementing a tool called **repo-inventory**. It lives in
`/path/to/repo-inventory`.

Part of the code is already written. The rest is broken into numbered tasks.
Each task is a separate file in this folder and is designed to be completed by
one agent in one session.

## Read these first, always

Before starting any task, read **all three** of these:

1. `00-overview.md` — what the tool is and how the pieces fit together
2. `01-current-state.md` — what code already exists and its exact API
3. `02-conventions.md` — hard rules about TypeScript, Node and style

Then read **only** your assigned task file. Do not read other task files; they
describe work that is not yours.

## Execution order

Tasks must be done in this order. A task assumes every earlier task is finished.

| # | File | Produces |
|---|------|----------|
| 03 | `03-task-install.md` | `node_modules`, `data/` dir, typecheck passing |
| 04 | `04-task-probes.md` | `probes/20`…`probes/60` — fact collection |
| 05 | `05-task-rules.md` | `rules/00-default.ts` — risk flags |
| 06 | `06-task-scan.md` | `core/scan.ts` — the pipeline that ties it together |
| 07 | `07-task-report.md` | `core/report.ts` — `INVENTORY.md` generator |
| 08 | `08-task-actions.md` | `actions/*.ts` — dry-run shell script generators |
| 09 | `09-task-server.md` | `server/index.ts` — HTTP API |
| 10 | `10-task-cli.md` | `bin/inventory.ts` — `scan`/`report`/`serve`/`dev` |
| 11 | `11-task-web-shell.md` | `web/` bootstrap, API client, layout |
| 12 | `12-task-web-table.md` | summary bar, filter bar, project table |
| 13 | `13-task-web-detail.md` | detail drawer, annotation editing |
| 14 | `14-task-web-scripts.md` | multi-select and script modal |
| 15 | `15-verification.md` | final acceptance run, README |

## Rules for every task

- **Do not change files outside the ones your task lists.** If you believe a
  file outside your scope is wrong, stop and write the problem in
  `specs/ISSUES.md` (create it if needed), then continue with what you can.
- **Do not add npm dependencies.** The dependency list is final. If you think
  you need one, you don't — write plain code instead.
- **Do not invent types.** Every type you need is already declared in
  `core/types.ts`. Import it with `import type`.
- **Every task ends with verification.** Run the commands in your task's
  "Verification" section. If they fail, fix your code until they pass. Do not
  report the task as done with failing verification.
- Never run `git push` or any destructive shell command on the user's
  repositories. When explicitly requested, semantic commits and merges are
  allowed after reviewing the complete worktree, preserving unrelated local
  changes, and checking staged diffs for secrets and whitespace errors. Stop
  rather than discard or auto-resolve conflicts.
- **Preserve existing comments.** The comments in the written code explain
  non-obvious decisions. Do not delete or reword them.

## Definition of done for the whole project

`cd /path/to/repo-inventory && npm run serve` starts a server
on <http://127.0.0.1:4747> that shows every project under `/path/to/code`
in a filterable table, lets the user mark each one active/obsolete/archived, add
a note, snooze it, and copy out a review-before-you-run shell script for bulk
cleanup actions.
