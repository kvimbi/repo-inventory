# Guidance history adapter handoff

`GuidanceHistoryCatalog` owns opaque `gh1_`, `gc1_`, and `ge1_` identities,
cursor binding, checkout confinement, byte-limited pages, and source-version
validation. Adapters implement `GuidanceHistorySource` in `source.ts`; they
return native IDs only and never write to client stores.

The shipped adapters are `OpenCodeHistorySource` (read-only `session`,
`message`, and `part` SQLite tables), `ClaudeHistorySource` (Claude Code
JSONL under `projects`, with optional Desktop metadata enrichment),
`CoworkHistorySource` (local Claude Desktop Cowork sessions under
`local-agent-mode-sessions/<account>/<organization>/`), and
`CodexHistorySource` (local Codex rollout JSONL under `sessions` and
`archived_sessions`, with optional title enrichment from `state_5.sqlite` and
projected history verification from `thread_history_1.sqlite`). New reviews
persist `historyReferenceVersion: 1`, qualified selected-session IDs, and a
source manifest. Reviews without that version retain the legacy OpenCode
session and `session:part` reference path.

Configuration flows through `Config`, `InventoryService`, Electron IPC/preload,
and the renderer: `openCodeDatabasePath`, `claudeConfigDir`,
`claudeDesktopSessionsPath`, `claudeCoworkSessionsPath`, `codexHome`, and
`guidanceHistorySources`. Empty directory overrides clear the saved override.
The focused fixtures in `server/guidanceReview.test.ts` exercise identical
native IDs across OpenCode, Claude, Cowork, and Codex, Desktop linkage/unavailability,
exact single-folder association, payload retrieval, cross-source cursor
rejection, and chronological timestamp sorting across providers.

Claude currently supports persisted local CLI JSONL and locally linked Desktop
Code metadata. Cowork supports local agent mode sessions strictly associated
when exactly one canonical userSelectedFolder matches the checkout; multi-folder
and ancestor-folder sessions are reported with explicit unavailable diagnostics.
Codex supports rollout JSONL with structured failure detection (never substring
matching) and projected history from SQLite when the projection watermark matches.
Stored order and `parentUuid` are preserved, but branch execution is not
reconstructed. Claude Chat exports and Antigravity are outside this adapter set.
