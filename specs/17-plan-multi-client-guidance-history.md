# Multi-client session review: research and implementation plan

Research date: 2026-09-07. Status: plan only; no feature implementation in this task.

## Decision

Extend the existing guidance review through isolated, read-only history adapters. Deliver **Claude Code, including locally backed Claude Desktop Code sessions**, first. **Codex is an optional second-agent follow-up**, not a dependency or acceptance requirement for the first delivery. Keep OpenCode working and allow mixed-source selections in one review.

**Claude Cowork local history is feasible as an independent follow-up after Tickets 1–4**, using the verified storage and association rules in Follow-up C below; it does not depend on Codex. **Claude Desktop Chat** needs an explicit export/import workflow. **Antigravity** has local history, but its binary payload decoder and checkout mapping are not yet established well enough for an implementation-only agent. Treat those as separate follow-up slices with explicit entry gates, not as pretend-complete adapters.

The history client and the reviewing model are independent. Continue using the configured Gemini review model and the existing proposal/apply flow. Adding Codex history does not mean running a Codex agent. The target remains the selected checkout's root `AGENTS.md`, as required by PRD 16. This does not automatically improve Claude's `CLAUDE.md` or Antigravity rules; support for other guidance targets requires a separate product decision.

## Verified support and limitations

| Client / mode | Evidence access | Readiness for this application |
| --- | --- | --- |
| OpenCode | Existing read-only SQLite integration with `session`, `message`, `part` | Preserve existing behavior. |
| Codex local CLI / desktop / IDE sessions | Official App Server history methods; local rollout JSONL; local metadata and projected history SQLite databases observed | Ready for an isolated local adapter with explicit format detection. Cloud-only history is outside this slice. |
| Claude Code CLI | Documented JSONL transcripts; SDK history-reading methods | Ready. Native records include user/assistant content and paired tool calls/results. |
| Claude Desktop, Code mode | Desktop metadata points to Claude transcript IDs on this machine | Ready for the verified local layout. Missing local transcripts and remote/VM-only sessions must be visible as unavailable, not silently assumed readable. |
| Claude Desktop, Chat mode | Official account data export | Importable in principle; no supported general-purpose local chat DB or personal-chat retrieval API was established by this research. Requires explicit project association. |
| Claude Desktop, Cowork (local) | Desktop metadata plus per-session Claude JSONL verified on this Mac | Feasible dedicated adapter; requires explicit folder association, separate identity and format guards. See Follow-up C. Cloud-only sessions remain outside local support. |
| Antigravity desktop / IDE | Local per-conversation SQLite and legacy `.pb` files observed; official CLI can import desktop conversations | Feasible research target, not a ready JSON/SQL adapter. Payloads in the sampled DB are binary. |

### Official source evidence

1. [Codex App Server](https://learn.chatgpt.com/docs/app-server): `thread/list` supports pagination and checkout filters; `thread/read` with `includeTurns: true` reads history without resuming. Paginated turn/item reads are experimental. Listing defaults to CLI/VS Code sources, so omitting source filters can miss other clients. `useStateDbOnly` avoids the documented list-time log scan/metadata repair. This is a viable future API backend; starting an App Server process is not a guarantee of zero local writes.
2. [Claude session storage and export](https://code.claude.com/docs/en/sessions): JSONL storage defaults to `~/.claude/projects/<project>/<session-id>.jsonl`; its internal format can change. Configured storage locations, retention, and disabled persistence affect availability. `/export` produces rendered text. A prompt sent with `--resume` continues a session and is not a read-only history API.
3. [Claude Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript): the indexed official reference documents `listSessions` and `getSessionMessages`. The full page could not be fetched by the browser tool because it exceeded its size limit; verify the chosen installed SDK declarations before adopting these helpers. Its documented worktree inclusion default is broader than this feature's checkout scope. Do not add the SDK merely to resume sessions.
4. [Claude Desktop documentation](https://code.claude.com/docs/en/desktop): Code Desktop and CLI share an engine/configuration but maintain separate session histories. The local metadata-to-transcript link below is observed implementation evidence, not a universal documented storage contract.
5. [Claude data export](https://support.claude.com/en/articles/9450526-export-your-claude-data): account chat history can be exported from web/Desktop privacy settings; availability differs for individual and organization accounts. This establishes an export route, not the completeness of tool evidence or a stable import schema.
6. [Antigravity resume](https://antigravity.google/docs/cli/commands/resume/): the CLI can clone desktop conversations including context/tool trajectories. Its last-conversation cache is a workspace-to-ID map, not the actual transcript. This operation mutates session state and must not be used as this application's automatic history reader.
7. [Antigravity CLI reference](https://antigravity.google/docs/cli/reference/): history navigation exists, but this research did not establish a documented read-only, structured history export endpoint.

### Local evidence, not a compatibility guarantee

Inspected metadata, record shapes and small samples using read-only file operations/SQLite. No model review was started and no source conversation was resumed. No private transcript bodies are copied into this document or fixtures.

**Codex:** `~/.codex/sessions` contained 282 JSONL files at inspection. `archived_sessions` also exists. Sampled rollouts have `session_meta`, `response_item`, `event_msg`, `turn_context`, and other metadata records. `session_meta.payload` includes `id`, `session_id`, `cwd`, `cli_version`, `source`, `thread_source`, and `history_mode`. Sampled response items include `message`, `function_call`, `function_call_output`, `custom_tool_call`, `custom_tool_call_output`, and `reasoning`.

`~/.codex/state_5.sqlite` has a `threads` table with `id`, `rollout_path`, `cwd`, `title`, `name`, timestamps, `archived`, `history_mode`, and other fields. `~/.codex/thread_history_1.sqlite` has:

- `thread_turns`: thread/turn IDs, rollout ordinals and byte offsets, status and timing.
- `thread_items`: thread/turn/item IDs, `rollout_ordinal`, `created_at_ms`, `item_json`, `item_type`, `updated_at_ordinal`.
- `thread_history_projection_state`: thread ID and next rollout byte offset/ordinal.

Observed projected items include user/agent messages, command execution, MCP tools, file changes, subagent activity, web search, reasoning, and compaction. These databases are internal formats, and the projection is not automatically proven complete or current. Do not hard-code a database filename and call every Codex release supported.

**Claude:** `~/.claude/projects` contained 55 JSONL files. Sampled content blocks include `text`, `thinking`, `tool_use` (`id`, `name`, `input`) and `tool_result` (`tool_use_id`, `content`, `is_error`). Records contain `uuid`, `parentUuid`, `sessionId`, `cwd`, timestamps and version metadata.

Desktop app version observed: `1.46388.4`. Metadata under `~/Library/Application Support/Claude/claude-code-sessions/<account>/<organization>/local_*.json` contains `sessionId`, `cliSessionId`, `cwd`, `originCwd`, title, archive flag and timestamps. Of 37 metadata records with a `cliSessionId`, 32 had a matching `~/.claude/projects/*/<cliSessionId>.jsonl`. The five unmatched records establish the need for an unavailable state; the cause was not determined. Do not copy other Desktop metadata such as MCP configuration into review evidence.

**Antigravity:** installed desktop `2.12.2`, IDE `2.5.5`. `~/.gemini/antigravity/conversations` contained 333 `.db` and eight `.pb` files. A recent DB has SQLite headers and these tables:

```text
trajectory_meta(trajectory_id, cascade_id, trajectory_type, source)
steps(idx, step_type, status, has_subtrajectory, metadata,
      error_details, permissions, task_details, render_info,
      step_payload, step_format)
gen_metadata(idx, data, size)
executor_metadata(idx, data)
parent_references(idx, data)
trajectory_metadata_blob(id, data)
battle_mode_infos(idx, data)
```

`steps.metadata`, `steps.step_payload` and the other sampled data fields are BLOBs. Their encoding, field definitions, enum meanings and reliable checkout association remain unverified. The application-support `state.vscdb` is a generic `ItemTable`, not proof of a readable transcript table. Opening the selected conversation DB directly with Python SQLite `mode=ro` failed with `unable to open database file`; schema inspection succeeded on a temporary copy of the DB and any existing sidecars. This copy was only a schema sample, not proof of a transaction-consistent full-history backup. A production reader needs a verified live read strategy; do not use `immutable=1` against a changing DB or ignore its WAL.

## Current source map

The history reader is currently a set of methods inside `server/guidanceReview.ts`, not an existing standalone module:

| Existing location | Current responsibility / change needed |
| --- | --- |
| `server/guidanceReview.ts:listSessions` | OpenCode SQL and exact resolved checkout matching; extract into adapter and aggregate sources. |
| `getHistory`, `getToolPayload` | OpenCode records, version checks and pagination; route through history boundary. |
| `historyRecords`, `sessionVersion`, `openDatabase` | Move schema-specific logic into OpenCode adapter. |
| `parseCallRef` | Splits on the first colon; must be replaced before introducing namespaced IDs. |
| `startReview`, `runReview`, `assertSourceVersions` | Selected sessions, source manifest, tool routing and apply-time validation must use the same qualified identities. |
| `validateEvidence`, `retainedEvidence` | Preserve retrieved-evidence checks and bind a citation's entry/call to its claimed session. |
| `core/types.ts` guidance types | Shared source metadata, availability, qualified identifiers and persisted manifest. |
| `core/config.ts`, `server/service.ts` | Source configuration and service wiring; several config return/update types are duplicated today. |
| `server/index.ts` guidance routes | Session-list response gains source diagnostics. Existing string IDs can remain opaque strings. |
| `electron/ipc.ts`, `electron/preload.ts`, `web/electronBridge.ts` | Keep Electron's signatures and result shapes aligned with HTTP. |
| `web/apiClient.ts` | Normalize the same session-list result in both transports; config type updates. |
| `web/components/GuidanceReviewModal.tsx` | Source labels/filtering, unavailable states, neutral copy and preview continuation. |
| `web/components/SettingsModal.tsx` | Explicit source-directory overrides and source enablement. |
| `server/guidanceReview.test.ts`, `package.json` | Existing Node test harness; extend it to discover new fixture tests. |

Current bounds are 2,048 bytes for inline input/error, 64,000 bytes and 40 entries per history page, and 16,000 bytes per payload chunk. Preserve these limits and enforce them on the serialized response envelope, not just string lengths. Successful tool output remains on demand. Current UI preview only displays the first page; the reviewer tools do paginate. Add a real “Load more” control when extending the selector.

The current checkout already has uncommitted edits in `server/chat.ts`, `server/guidanceReview.test.ts`, `server/guidanceReview.ts`, `web/components/ChatModal.tsx`, `web/components/GuidanceReviewModal.tsx`, and `web/components/SettingsModal.tsx`. Read the live diff before editing; preserve it. Do not restore or overwrite these files wholesale.

## Fixed design choices for the implementing agent

### 1. One history boundary, explicit adapters

Create `server/guidanceHistory/` with `catalog.ts`, `references.ts`, `bounds.ts`, `openCode.ts`, `claude.ts`, and `jsonl.ts`. The optional second agent adds `codex.ts` and, in its later projection slice, `codexProjection.ts`. Do not create Codex stubs or settings in the first delivery. Keep shared domain interfaces in `core/types.ts`; adapter parsing helpers can remain private.

Define a `GuidanceHistorySource` contract with these operations:

```text
listSessions(checkout) -> source-local summaries and diagnostics
getHistory(checkout, nativeSessionId, cursor?) -> normalized bounded page
getToolPayload(checkout, nativeSessionId, nativeCallId, section, cursor?) -> bounded payload
getSessionVersion(checkout, nativeSessionId) -> content version
```

The catalog owns qualified IDs, checkout/selection authorization and dispatch. Adapters own native storage lookup, native IDs, parsing, ordering, source versions and payload availability. The reviewer owns proposals and approved writes. Do not add `switch (client)` throughout the review loop or mix history adapters into `agentRunner.ts`, `opencodeRunner.ts`, probes or generated actions.

Discovery must isolate failures per source with bounded concurrency. Return `GuidanceSessionList { sessions, sources }`, where each source diagnostic has source ID, state (`ready`, `missing`, `unsupported`, `error`, `disabled`), and optional reason. A missing OpenCode DB must not prevent Claude selection. A valid source with zero checkout matches is `ready` with zero matches, not missing. Catch errors at the source boundary without hiding them.

Use one `claude` adapter and distinguish `claude-cli` / `claude-desktop-code` as display provenance. Native `cliSessionId` is the transcript identity; a matching Desktop record enriches that transcript rather than producing a duplicate. Do not infer a desktop client solely from a filename.

### 2. Opaque, qualified references and legacy compatibility

Keep public `sessionId` and `callRef` as strings to avoid changing every tool argument. Encode a versioned JSON tuple in base64url:

```text
session ID: gh1_ + base64url([sourceId, nativeSessionId])
call ref:   gc1_ + base64url([sourceId, nativeSessionId, nativeCallId])
entry ID:   ge1_ + base64url([sourceId, nativeSessionId, nativeRecordId, blockIndex, chunkIndex])
```

These are lookup keys, never filesystem paths. Validate prefixes, tuple lengths, field types and reasonable input lengths. Resolve native IDs only through adapter discovery under configured roots. Do not concatenate a supplied ID into a path. Bind cursors to source, session, payload section/call when applicable, content version, and position; reject cross-session/cross-section cursor reuse.

Preserve old persisted reviews without a bulk migration: absent reference-version metadata means legacy OpenCode IDs and `session:part` references. Decode those only in the explicit legacy path. New reviews persist `historyReferenceVersion: 1` and a selected session manifest containing qualified ID, source, native ID, client label, title, directory and decoder version. Existing `selectedSessionIds`, `sourceVersions`, edit evidence and retained-evidence keys must agree. Do not rewrite old evidence hashes or raw IDs. Old completed proposals remain displayable without a present source; applying still performs the existing source checks.

When validating evidence, check both that it was retrieved and that its decoded source/session matches `evidence.sessionId`. A citation retrieved from selected session B cannot claim session A. Replace all first-colon parsing, including the model tool's selection check.

### 3. Read-only local stores first

Use Node's existing `node:sqlite` and filesystem support. No new agent process, auth flow or paid model call for discovery/preview. No dependency is required for the first adapters. Official Codex App Server and Claude SDK helpers are alternatives for a future backend; do not implement both alternatives in the initial slice.

Configuration: retain `openCodeDatabasePath`; add optional `claudeConfigDir`, `claudeDesktopSessionsPath`, and an explicit enabled-source list for OpenCode and Claude. Resolve the Claude root from `CLAUDE_CONFIG_DIR` when set, otherwise its normal home directory. The optional Codex follow-up adds `codexHome` and Codex source enablement, resolving from `CODEX_HOME` when set, otherwise its normal home directory. The verified Desktop default is macOS-specific; other platforms require a configured root until their paths are verified. New optional settings must survive get/save/reload through all config seams listed above. Empty override input clears the override to `undefined`. Do not scan arbitrary application folders or interpret credential/configuration files as transcript evidence.

Canonicalize actual checkout and stored `cwd` with `realpath` where possible. Missing/unresolvable or ambiguous paths cannot authorize history by string similarity. Preserve explicit direct-child selection, but do not include children automatically. A matching remote, basename, `originCwd`, or common Git repository is insufficient to include another worktree's transcript. Worktree association expansion is a separate feature.

### 4. Stable, bounded evidence

Use streaming JSONL indexing; do not repeatedly `readFile` and parse every complete transcript for each page or build an unbounded whole-home transcript cache. Index candidate file metadata first, then index record offsets/content only for the requested checkout/session. Cap simultaneous file reads. Record stable native IDs where available; otherwise use source byte offset plus block/chunk index.

For a selected source file, compute a streaming content hash plus decoder version. Check identity/stat information before and after building the index and recompute content version at review/apply validation. Stat metadata alone is not a durable content version. Store the pinned versions in the review. Append, replacement, truncation, missing file, or schema change invalidates subsequent review reads/apply; return a clear restart-required result. Do not silently consume new records mid-review. This follows the current strict source-change behavior; snapshotting active sessions is not part of this change.

Discard an unterminated JSONL tail from the readable prefix with an explicit incomplete reason; do not call it a valid final message. A malformed interior record or unknown evidence-bearing type yields a bounded marker and incomplete coverage, not an empty successful transcript. Known bookkeeping records may be omitted deliberately. Preserve compaction markers and explain unavailable pre-compaction content. Never reconstruct unavailable reasoning, images, or omitted outputs.

## Ordered implementation tickets

The first agent owns Tickets 1–4 and delivers working Claude plus OpenCode reviews. Complete one ticket and its acceptance checks before proceeding. Codex Tickets C1–C2 belong to an optional second agent after the first delivery; they must not delay or expand the first agent's scope. Do not perform a broad refactor of unrelated review, chat or settings behavior.

### Ticket 1 — Extract OpenCode without changing behavior

Move the database/schema operations and shared bounds into the new files. Wire `GuidanceReviewService` to the catalog with only OpenCode enabled. Keep existing IDs/results during this extraction ticket; introduce namespacing in Ticket 2. Preserve the OpenCode version hash algorithm so saved reviews do not become stale merely because of extraction. Extend constructor injection only as needed to use fixture source roots.

Acceptance: all existing tests pass; list, preview, payload and apply-time checks still use OpenCode; missing DB remains an explicit error in this interim slice; original read-only DB behavior and exact edit application remain intact.

### Ticket 2 — Multi-source contracts, references and transports

Implement the contracts and legacy decoder above, add list diagnostics, persist new manifests and reference version. Route all source-version checks through the catalog, including apply-time checks. Update Fastify, service, IPC, preload, bridge and API client together. Initially still register only OpenCode; use fixture adapters for collision/failure tests.

Acceptance: two fixture sources may use the same native session/call IDs without collisions; wrong-source/session references and cursors fail; one broken source does not hide healthy ones; old version-1 stored OpenCode reviews still load and can follow their normal apply checks; a disappearing selected source produces an explicit failure, not silent deselection.

### Ticket 3 — Claude transcripts and Desktop Code linkage

Discover only `projects` under the configured Claude root. Do not rely solely on the lossy directory slug; verify recorded `cwd` and `sessionId`. Use `uuid` plus content-block index for evidence IDs. Preserve record ordering and `parentUuid` branch metadata; do not flatten divergent branches into one linear history. If branch reconstruction is not yet reliable, expose an explicit branch limitation rather than claiming a single executed sequence.

Normalize text blocks and `tool_use`/`tool_result`, pairing by tool ID within one native session. Tool results inside a `user` message are tool evidence, not user corrections. `is_error` determines an explicit failed result; absent result remains unknown. Handle string and block-array content, interruptions, compaction, and unsupported blocks. Subagent transcripts must be separately selectable only when a verified parent relationship exists; never automatically merge them into the parent.

Read only the needed Desktop metadata fields from the configured Desktop session directory. Join `cliSessionId` to the transcript index, verify the actual transcript checkout, and label it Claude Desktop Code. Use Desktop title/archive metadata where present. `originCwd` describes provenance, not permission to include a different worktree. An unmatched metadata record with a matching checkout appears disabled with “Local transcript unavailable.” No speculative search of VM disks or unrelated accounts' application data.

Acceptance: CLI-only, linked Desktop, missing Desktop transcript, duplicate linkage, unrelated checkout, sidechain/branch, string content, mixed content and error-result fixtures pass. A real locally backed Desktop Code session lists once and its tool input/result can be previewed. No Claude process is launched.

### Ticket 4 — Finish the selector and reviewer integration

Add source/client badges and an optional source filter; allow cross-client selection. Show source diagnostics separately from the valid-empty state. Disable selection/preview for unavailable transcripts. Reset selection/history when project changes and ignore stale async responses from the prior project. Keep selected IDs stable when filtering.

Use client-neutral loading/help copy, while naming the configured review model and exact target file. Include source/client/decoder/limitations in the review manifest. Add preview continuation using `nextCursor` and display incomplete coverage. Keep current error/input bounds and on-demand payload behavior. Preserve individual edit selection, combined confirmation, cancellation, proposal validation, and write recovery.

Acceptance: in both web and Electron, select an OpenCode and a Claude fixture session, preview multiple pages, retrieve payloads and run a disposable-project review. A proposal cannot cite an unselected session or mismatched evidence. Source failures leave other clients usable. No request resumes a source agent or edits its native guidance/configuration.

## Optional second-agent follow-up — Codex

Start only after Tickets 1–4 are complete and their shared history contract is verified. Reuse the catalog, reference codec, bounds, JSONL helpers, selector and both transports produced by the first agent. Read its completion report and current source before coding; do not reimplement the shared boundary from this original plan. The first agent's delivery is complete without Codex.

The first agent must leave a concise handoff recording the actual adapter interface, reference/storage compatibility rules, fixture helpers, configuration wiring, checks run and known limitations. The second agent owns Codex-specific readers, tests, configuration and registration. Add `codexHome` through all existing config seams and include Codex in source enablement and labels. Run the same web/Electron selection and review checks with Codex, and retain OpenCode/Claude regression coverage. No second agent is started by this plan revision; this is a handoff for later execution.

### Ticket C1 — Codex rollout history

Discover `sessions` and `archived_sessions` under the configured Codex root. Read `session_meta` for session identity/cwd; use a bounded metadata index, with a neutral fallback title. Do not use the prompt-only `history.jsonl` as the transcript. Metadata SQLite may enrich titles, but absence must not block valid rollouts.

Normalize:

- `response_item.message`: user/assistant readable text blocks; preserve assistant phase where present. Do not surface system/developer configuration dumps as user intent.
- `function_call` + `function_call_output`: pair by `call_id`; arguments become input and persisted output becomes output.
- `custom_tool_call` + `custom_tool_call_output`: preserve freeform input; do not assume it is JSON.
- Mark completion, compaction and child references from supported record shapes. A fork is not automatically a child or authorization to read another transcript.
- Prefer response items for message/tool evidence; do not emit `event_msg` copies as duplicate messages. Use event records only for supported lifecycle/status evidence absent from the response item.
- Preserve a missing result as unavailable/unknown. Function-call outputs are not uniformly structured exit-code records: set failure only from a verified structured status/exit code or explicit error, never a substring such as “error”. Do not split combined output into invented stderr.
- Encrypted reasoning is unavailable; only persisted readable content can be reviewed. Images/binary results get availability markers, not base64 dumped into a page.

Record a limitation if the rollout signals an unsupported history mode; do not infer an undocumented history-mode enum from its name. Scope first delivery to verified complete legacy rollout histories.

Acceptance: synthetic fixtures cover both tool families, duplicate event/message representations, missing results, large UTF-8 bodies, compaction, archived sessions, cwd mismatch and source mutation. One completed real local Codex session can be listed and paged read-only with paired tool details. Report tested client/storage versions. No claim of database-only history support yet.

### Ticket C2 — Codex projected history compatibility

Implement only after Ticket C1. Add a separately guarded reader for the observed `state_5.sqlite` and `thread_history_1.sqlite` layouts. Verify required columns and inspect history-mode/rollout linkage. Do not select an arbitrary highest-numbered DB as automatically compatible.

Map normalized `item_json` types: `userMessage` content, `agentMessage.text`, `commandExecution.command`/`aggregatedOutput`/`exitCode`/`status`, `mcpToolCall.arguments`/`result`/`error`, file changes, compaction and child references. Order by verified rollout position with deterministic tie-breaking. Check JSON shape as `unknown` before use.

Establish a fixture-backed rule for when a projection is complete enough to be authoritative, using the projection watermark and matching rollout state. Choose one authoritative representation per session version; never concatenate projected items and raw rollout copies. If completeness or a database-only mode cannot be established, return unsupported/incomplete and retain rollout support where proven. Hash relevant rows inside a read transaction and revalidate linked source versions; do not treat a global DB mtime as a per-session version.

Acceptance: current observed schemas parse; stale projection, missing rollout, partial rollout, schema mismatch, duplicate representations, same-time records and database mutation all have deterministic outcomes. Prove one local projected session's user text, one successful command and one failed/MCP call against stored evidence. If the authority rule remains unresolved, stop this ticket with the exact fixture/schema gap; do not disable working legacy support.

## Separate future work

### Follow-up A — Antigravity decoder investigation, then adapter

This is a research ticket; do not assign it as routine SQL mapping. Deliver a documented, versioned decoder before promising support. Starting points are the observed `steps` BLOBs, trajectory metadata, parent references and installed client serializers or a documented read API if one becomes available. Do not infer enum meanings or protobuf field numbers from plausible-looking text.

Required exit evidence: one verified user turn, assistant response, successful tool input/output, failed tool/error, ordered trajectory, checkout association, child relation, and a live read-only consistency strategy. Produce synthetic fixtures mirroring those verified shapes and document app/storage versions. Legacy `.pb` files require a separate compatibility path or an explicit unsupported result.

Only after those checks pass, add `antigravity.ts` behind the same interface and run the shared contract tests. If only artifacts/brain summaries can be read, label them artifact evidence; they are not full chat history. Do not automate `/resume`, desktop-to-CLI cloning, undocumented authenticated endpoints, or a model-generated “export my chat” request as substitutes for original persisted evidence.

### Follow-up B — Claude Chat export import

Obtain a user-selected actual export and validate its schema before writing an importer. Build a separate import workflow: choose file, preview conversations, explicitly bind selected conversations to a project, retain normalized evidence and export hash in private app storage. It must work through web file upload and Electron selection with bounded size/record validation. Do not accept arbitrary server filesystem paths from the browser.

Display “Imported Claude chat” and its evidence limitations. Preserve text, timestamps and stable exported IDs when available; mark tool inputs/results unavailable when the export lacks them. Do not infer a repository from conversation titles or silently import the whole account. Import/delete storage lifecycle and transport endpoints need their own spec once an actual export is available. This slice does not include Cowork.

### Follow-up C — Claude Cowork local sessions

Investigation added 2026-09-07. **Yes: add a separate `cowork` history source labelled “Claude Cowork (local)”.** Reuse the shared catalog and Claude content normalization after Tickets 1–4; do not fold Cowork into Desktop Code discovery or wait for Codex. This is a plan addition only. The current worktree already contains `server/guidanceHistory/`; read its `README.md`, `source.ts`, `claude.ts`, catalog and live diff before implementation because the earlier source map is a research-time snapshot.

#### Storage and verified evidence

On this Mac, Claude Desktop `1.46388.4` stores local Cowork data beneath:

```text
~/Library/Application Support/Claude/local-agent-mode-sessions/
  <account>/<organization>/
    local_<id>.json                         # Desktop session metadata
    local_<id>/
      .claude/projects/<encoded-workspace>/<cliSessionId>.jsonl
      audit.jsonl
      outputs/
      uploads/
```

Read-only inspection found 286 top-level session metadata files and 285 main transcript files; 278 metadata records joined to a main transcript by `cliSessionId`. These are snapshot counts, not a promise of 278 complete histories. Metadata includes `sessionId`, `cliSessionId`, `title`, `createdAt`, `lastActivityAt`, `isArchived`, `cwd`, `userSelectedFolders`, `hostLoopMode` and `sessionType`. Both host-loop flag values occur; do not infer decoder compatibility from that flag alone.

Two sampled main transcripts report embedded Claude versions `2.1.160` and `2.1.219`. They contain user/assistant records, stable UUIDs, parent UUIDs, timestamps, and `text`, `thinking`, `tool_use` and `tool_result` blocks. All 25 tool results in the first sample pair to calls, including four explicit `is_error: true` results; all 16 in the second pair as well. This proves readable message/tool structure, not universal format or full branch coverage. Bookkeeping and attachment records also occur and need explicit handling. `audit.jsonl` is another event stream with audit fields; its completeness and equivalence are unverified. Do not concatenate it with transcripts or use it as an automatic fallback. Artifacts are not conversation history.

The sampled `cwd` values point to Cowork's own `outputs` directory, not the user's project. Across metadata, 277 sessions have one selected folder, four have two, and five have none; none selects this repo-inventory checkout exactly. Therefore adding a decoder alone will not populate this project's list with those sessions.

These paths and fields are observed internal storage, not an Anthropic compatibility contract. Current [Cowork architecture documentation](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview) distinguishes local execution from cloud execution and says cloud sessions/files are stored with the account. A local reader must not promise all Cowork history. The [Compliance API FAQ](https://platform.claude.com/docs/en/manage-claude/compliance-faq) documents separate local/remote transcript endpoints for Enterprise access; that is a separate authenticated integration, not required for this filesystem adapter. Windows paths and cloud-cache formats were not verified.

#### Small implementation slice

1. **Discovery and configuration.** Add `cowork.ts` implementing the live history interface, `claudeCoworkSessionsPath`, and `cowork` source enablement through config, service, HTTP/Electron and Settings. Default to the verified macOS root; require an override on unverified platforms. Read only fixed-depth metadata and the corresponding session's transcript directories, with bounded reads and realpath containment. Do not recursively scan plugins, uploads, outputs, credentials or configuration dumps. Use an opaque native identity containing account/organization scope plus Desktop session ID; verify metadata ID, transcript filename and record session ID linkage. Missing, ambiguous or unsupported transcripts remain visibly unavailable.
2. **Project association.** For this first slice, automatically associate only when `userSelectedFolders` contains exactly one canonical existing directory equal to the selected checkout. This is an explicit Cowork-specific association rule; retain the native execution `cwd` separately. Multi-folder, absent-folder, ancestor-folder and unrelated-folder sessions are excluded from automatic selection, with a bounded diagnostic explaining why. Do not match titles, prompt paths, folder basenames or `/mnt/...` VM paths. A later user-directed “Associate session with project” workflow can cover these cases, but needs its own persisted mapping and review-scope design; do not silently import unrelated history.
3. **History and selection.** Extract a shared Claude block decoder only where the verified shapes agree; Cowork owns storage lookup and association. Pair tools within one transcript, retain explicit failures and missing-result limitations, and handle meta user records without presenting injected context as user corrections. Keep subagents separate and unsupported attachment/binary content explicit. Reuse bounded paging/payloads, source diagnostics and reference validation. Hash the transcript plus allowlisted metadata affecting identity/association and decoder version, so changes to selected folders invalidate a pinned review. Register the distinct badge/filter and allow mixed OpenCode/Claude/Cowork selections through both transports. Keep the review model, selected checkout's `AGENTS.md`, and edit approvals unchanged; this does not edit Cowork global instructions or project memory.

Acceptance: synthetic fixtures cover exact single-folder association, multiple/no/ancestor folders, duplicate IDs across account scopes, missing or mismatched transcripts, tool success/failure, unsupported records, partial tails and metadata/transcript mutation. Reuse cross-source cursor and citation tests. Verify one consenting disposable-project Cowork session through listing, preview, payload and mixed-source review in web and Electron; existing unrelated sessions are storage evidence only. Run `npm test`, `npm run typecheck`, both builds and the required scan for shared config/type changes. Report tested local formats separately from unavailable VM/cloud history. No source agent is launched or resumed.

## Verification and completion checklist

The repository instructions saying “no tests” are stale: `npm test` currently runs four `node:test` tests in `server/guidanceReview.test.ts`. Extend the npm test command with explicit new test paths or a verified Node discovery pattern; adding tests that the command never runs does not count.

Shared adapter contract fixtures must cover: project confinement, qualified-ID collision, unavailable source, malformed/unknown data, exact ordering, no duplicate steps, multibyte page/payload boundaries, cross-resource cursor misuse, incomplete tails, version changes, missing payloads, child selection, and citation ownership. Use synthetic data in temporary directories, never copies of private transcripts in Git. Exercise completed legacy review loading and source-validation behavior as well as new mixed-source reviews.

For each implementation ticket: run `npm test` and `npm run typecheck`. After UI/transport integration run `npm run build:web` and `npm run build:electron`; exercise web on Vite port 4748 and the Electron IPC path. Run `npm run scan` when `core/` (including shared types/config), `probes/`, or `rules/` changes, as required by AGENTS.md. Do not rewrite annotations or regenerate reports unnecessarily.

Final live acceptance uses a disposable checkout and selected sessions only: list, multi-page preview, bounded tool payload retrieval, one configured-provider review, explicit selected-edit confirmation and verified write. Report separately what passed in fixtures, compilation/build, local-store inspection, transports and the real provider. No inference that readable storage guarantees a successful model review.

Research-task baseline: `npm run typecheck` passed with zero errors; `npm test` passed all four existing tests. No scan/build/live-provider run was needed or performed for this documentation-only task. No implementation claim is made by these baseline checks.

## Copyable kickoff for the first agent — Claude delivery

Read `AGENTS.md`, `specs/02-conventions.md`, `specs/16-prd-agent-guidance-review.md`, this plan, and the current working diff. Implement Tickets 1–4 in order to deliver Claude Code and locally backed Claude Desktop Code history alongside OpenCode. Do not implement Codex Tickets C1–C2 or their settings/stubs; those are optional work for a second agent. Do not implement Antigravity, Claude Chat import or Cowork. Keep all new shared types in `core/types.ts`, use `.ts`/`.tsx` imports and `import type`, avoid `any` and non-erasable TypeScript syntax. Preserve current dirty work. Do not change the review model, target file, approval semantics, annotations, agent runners, or scanners except the specified shared config/types. Finish with an exact report of client/storage formats supported, remaining limitations, changed files, verification results, and the concrete history-adapter handoff needed by the optional second agent.


## Copyable kickoff for the optional second agent — Codex follow-up

Read `AGENTS.md`, `specs/02-conventions.md`, PRD 16, this plan, the first agent's completion report and the live source/diff. Confirm Tickets 1–4 are complete; if the shared boundary is incomplete, report the missing prerequisite rather than replacing the first agent's work. Implement Ticket C1, then C2 only within its verified schema/completeness gate. Reuse the shipped history contracts and add Codex configuration, registration and fixtures. Preserve Claude/OpenCode behavior, stored review compatibility, model, target and approvals. Do not implement Antigravity, Claude Chat import or Cowork. Run the shared regression suite, typecheck, applicable scan/build checks and Codex web/Electron acceptance checks; report rollout and projected-history support separately, with any unresolved storage-format limits.
