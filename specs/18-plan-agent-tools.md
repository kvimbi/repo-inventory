# Agent Tools: implementation plan

Date: 2026-09-07. Status: approved direction, implementation plan only.

## Outcome and scope

Add two peer application sections: **Projects** and **Agent Tools**. Projects
continues to own repository inventory, project configuration, project skills,
and project guidance review. Agent Tools owns the user's machine-level tool
inventory and global configuration. Neither section calls through the other.

V1 includes Codex, OpenCode, Claude Code, Antigravity, and Gemini CLI as known
tool entries. A known entry is not a claim that the tool is installed or that
every discovery capability is implemented. Target global skills, saved
sub-agent definitions, global instructions, configuration files, and a
**read-only list of globally configured MCP servers** for each tool where its
native format can be verified. Surface unsupported capabilities explicitly.
Local recent sessions are a separately deliverable V1 slice using existing
history sources; Antigravity and Gemini session decoders are outside V1.

This is local machine inventory. Do not install or upgrade tools, synchronize
skills, modify configuration internally, launch/resume sessions, connect to MCP
servers, run agents, or introduce automatic optimization. Cloud-only data,
usage analytics, and a general plugin framework are outside scope.

## Current code evidence

- `web/App.tsx` owns inventory loading and most project UI state. Extract this
  into a Projects feature before adding the peer view; the application shell
  must not depend on a successful inventory request.
- `web/components/SkillsModal.tsx` aggregates skills from inventory projects.
  Keep it under Projects; global skills are a different inventory.
- `server/agentRunner.ts` registers `codex`, `opencode`, `claude`, `agy`, and
  `gemini`. Its availability check runs synchronous version probes. Do not
  reuse that execution module as global discovery or expand prompt-running
  behavior in this work. Verify the mapping from `agy` to the Antigravity
  installation during recon rather than assuming identity from the label.
- `server/guidanceHistory/source.ts` requires a checkout for listing and reads.
  `catalog.ts` enforces canonical checkout membership, source-qualified IDs,
  bounded pages, cursor binding, and source-version checks.
- Existing history adapters cover OpenCode, Claude, Cowork, and Codex. Their
  existence does not establish machine-wide listing support.
- HTTP and Electron currently compose `InventoryService` in `server/index.ts`
  and `electron/ipc.ts`. `web/apiClient.ts` selects HTTP or IPC. New feature
  entry points use both transports without putting business logic in them.
- `npm test` currently names only `server/guidanceReview.test.ts`; new suites
  must be added to the default test command explicitly.

These observations describe repository code, not verified current vendor
configuration schemas. Ticket 1 establishes the native-format evidence.

## User experience

Keep Projects as the initial section. Switching sections preserves project
selection and filters for the current application session. Agent Tools remains
usable when inventory is missing, scanning, or failed. Each section owns its
loading, error, empty, and refresh states. Scanning repositories does not scan
global tool configuration, and refreshing Agent Tools does not scan projects.

Agent Tools shows a tool list and selected-tool details. Each entry shows its
installation state, version when available, and discovery warnings. Details
contain Overview, Skills, Sub-agents, Instructions, MCP servers, Configuration,
and, once delivered, Recent sessions. These may be simple detail tabs; avoid a
second top-level navigation system for V1. Lists have local search.

| Detail | V1 presentation and actions |
| --- | --- |
| Overview | Executable/app paths, version, configured roots, last refreshed time, capability states. |
| Skills | Name, description, origin, source path, activation state when known; bounded content preview. |
| Sub-agents | Saved definition, description, explicit model/tool restrictions when present; source and preview. Historical child runs are sessions, not definitions. |
| Instructions | User-level instruction documents; source, preview, open in editor. Project documents stay in Projects. |
| MCP servers | Server name, declared transport when recognizable, enabled/disabled/unknown state, source configuration, duplicate/conflict indication where proven. No connection-health claim. |
| Configuration | Discovered existing files; Open in editor, Reveal in folder, Copy path. Multiple files are individually selectable. No embedded editor or file creation. |
| Recent sessions | Title, native client/mode, last activity when available, project/directory association, transcript availability; view history and open known project. |

Configuration files are opened externally rather than rendered wholesale:
they may contain credentials. Skills/instructions/agent-definition previews
use bounded, sanitized text/Markdown and no executable embedded content.

## Domain and discovery contracts

Put new shared domain types in `core/types.ts`, following repository
conventions. Keep implementation-only parsing shapes private to adapters.

- **Tool identity** identifies the product integration, independently from a
  history source or coding runner. One tool may have several client modes and
  history sources; Cowork is a distinct history source, not a new CLI entry.
- **Installation** records discovered executable/app candidates and the
  selected executable, if any. Missing executable, retained config, and retained
  history are independent facts. A tool can be absent while its data remains.
- **Capability result** carries `ready`, `unsupported`, `missing`, or `error`,
  items, and bounded diagnostics. A ready empty list means no entries found in
  the supported inspected scope. Report partial reads and truncation explicitly.
- **Global resource** records kind, tool association, display metadata,
  configured path, canonical file identity, origin (user/shared/plugin/bundled),
  and activation (`enabled`, `disabled`, `unknown`). Global means applicable
  beyond one project, not proof it is enabled in a live session.
- **Configuration reference** identifies a file discovered by the backend;
  callers pass that reference, never an arbitrary filesystem path for access.
- **MCP server declaration** records name, tool, configuration reference,
  transport and enablement only when supported by evidence. Preserve separate
  declarations from different files; resolve precedence only when established
  by the native schema. Do not invent a merged effective configuration.

Deduplicate physical resources by canonical identity within a result while
retaining each discovery path and tool association. Shared/symlinked skills
must not masquerade as independent copies. Follow symlinks only from discovered
supported resource locations, with bounded traversal and loop detection;
revalidate the discovered target before file access or editor launch. A changed
target requires refresh, not silent access to a new destination.

Discovery reads supported global roots, including verified environment/config
overrides. Do not recursively search the entire home directory, inspect project
configurations, execute config files, or evaluate arbitrary config expressions.
Use bounded asynchronous reads and version probes with timeouts and capped
output. Isolate failures by tool and capability. Coalesce concurrent refreshes;
cache in memory until manual refresh for V1. Do not persist credentials or
copied configuration in inventory data.

For MCP, project-only declarations are excluded even when stored inside a
user-level file. Scope comes from the native schema, not file location alone.
Only safe allowlisted metadata crosses HTTP/IPC. Do not return command arguments,
environment values, headers, credential-bearing URLs, or raw configuration
snippets in MCP results, errors, or logs. V1 does not need an endpoint or command
column. Disabled declarations remain visible; configured does not mean connected,
authenticated, healthy, or available to a particular running session.

## Module ownership and interfaces

### Agent Tools

Create `server/agentTools/` for the catalog, tool-specific discovery adapters,
configuration-reference resolution, and resource access. Its small public
interface supports tool summaries, selected-tool details, refresh, bounded
resource preview, and opening/revealing discovered files. Proposed operations:
`listTools`, `getToolDetails`, `refresh`, `readResource`, `openConfiguration`.
Define exact request/result types in Ticket 1 before implementation.

Do not require a history implementation to implement configuration discovery.
Do not add global tool facts to `ProjectFacts` or the repository scan pipeline.
Use `web/features/agentTools/` for the feature UI and a feature client over the
existing HTTP/IPC selection seam. HTTP routes and IPC handlers invoke the same
module with identical input validation and result/error semantics.

Editor/reveal actions resolve only current discovered file references and use
an allowlisted native launcher with argument arrays and no shell. The backend
host opens the file in both runtime modes; document that a remote browser cannot
open its own local editor through this feature. Missing launcher/files produce
an actionable failure and Copy path remains available. These explicit actions
do not write the file; any edits happen in the user's editor. Keep `/api/doc`
and its project allowlist unchanged.

### Shared session history

Extract reusable history into `server/sessionHistory/` during the sessions
slice, preserving a compatibility facade where needed. Both features consume
it directly; guidance review still owns selected sessions, review state,
proposals, and root instruction writes.

Keep the existing explicit project-scoped listing/read contract. Add an
explicit global discovery/read contract; never make omitted checkout mean
unrestricted access. Global reads must resolve an issued source-qualified
session reference through the source's discovered session catalog and its
permitted stores. A caller-supplied path is not authorization.

Machine-wide discovery enumerates native session stores/indexes, not scanned
projects. Resolve known project links from canonical checkout associations;
unknown, removed, multi-folder, and projectless sessions remain visible with
honest association/availability states. Reuse existing source rules rather than
inventing project association from arbitrary transcript text. Native listing
metadata is not transcript evidence.

Preserve `gh1_`, `gc1_`, and `ge1_` identities, existing persisted review
compatibility, source versions, bounded payloads, and cursor confinement.
Global access does not widen the project review's eligibility rules. Listing a
multi-folder session globally does not make it reviewable for one checkout.

List metadata first, page recent sessions per tool, and read transcript bodies
only when opened. Ticket 1 must specify discovery work bounds and native-index
fallback behavior; limiting returned rows alone does not bound disk reads.
Keep child relationships and client modes explicit and avoid duplicate listings
of one session available through multiple native metadata sources.

## Sequenced implementation tickets

Each ticket uses RECON -> SPECIFY -> IMPLEMENT -> REVIEW -> FIX -> VERIFY under
`implementation-workflow`, with the prescribed custom agents and fresh bounded
stage artifacts. The coordinator owns design decisions. This document is the
acceptance boundary; additional features require a separate scope decision.

### 1. Verify native discovery and freeze contracts

Read-only recon of supported installed tool versions, executable identities,
global roots/overrides, formats, scope, symlinks, plugin origins, enablement,
and MCP configuration precedence. Consult current official documentation for
each supported vendor format; record links and inspection date. Inspect local
shapes without copying private config or transcripts into specs/fixtures.

Produce a capability matrix for all five tools, synthetic fixture examples,
exact module/request/result contracts, and numeric traversal/read/probe/page
bounds. Identify parser dependencies needed for TOML/JSONC or other formats;
reuse suitable existing dependencies or specify a justified maintained parser.
Do not implement configuration parsing with regexes or evaluate executable
configuration. Specify an unsupported state for unverified native formats.

Also identify startup work that blocks Agent Tools, existing history constructor
ownership, and a migration map preserving review callers. Record which global
session listing/read capabilities can reuse each existing adapter unchanged
and which need bounded changes. Antigravity/Gemini history stays deferred.

Acceptance: every tool/capability is supported by evidence or explicitly marked
unsupported with a reason. Missing local installation is distinguished from an
unsupported format. No later implementation agent has to guess native paths,
schemas, resource access rules, or limits. Do not mark supported capabilities
unsupported merely to avoid implementation work.

### 2. Deliver the application shell and tool overview

Depends on Ticket 1. Extract current project state/UI into
`web/features/projects/`; keep `web/App.tsx` as the shared shell. Implement tool
catalog/installation discovery and the overview end to end through HTTP and IPC.
Compose Agent Tools independently of inventory scan completion. Add new tests
to the default test command.

Likely files: `web/App.tsx`, project/header components, new feature directories,
`server/agentTools/`, `server/index.ts`, `electron/ipc.ts`, preload declarations,
`web/apiClient.ts`, `core/types.ts`, `package.json`, and focused tests. Confirm
the precise preload/type file paths during recon.

Acceptance: both sections load independently, switching preserves Projects
state, installed/config-only/missing/error states are accurate, and refresh is
scoped to Agent Tools. Existing project actions still work in web and desktop.

### 3. Deliver global resources and external configuration editing

Depends on Ticket 2. Implement verified tool adapters for skills, saved
sub-agents, instructions, and configuration references. Render searchable lists,
source provenance, activation states, bounded previews, and editor/reveal/copy
actions in both transports. Avoid moving project skills into this feature.

Acceptance: supported resources match synthetic fixtures and sampled local
sources; shared-file identity is retained; missing/unsupported/error/empty are
distinct; preview is bounded and sanitized; stale or forged file references are
rejected; opening a configuration file does not execute its contents.

### 4. Deliver global MCP server inventory

Depends on Ticket 3's configuration discovery. Extend the same adapters with
the safe MCP metadata projection; implement the MCP detail view end to end.
Keep MCP configuration parsing independent of an MCP runtime/client.

Acceptance: include enabled, disabled, and unknown declarations; exclude
project-scoped entries embedded in global files; retain origin and unresolved
duplicates; malformed files isolate failure; unsupported formats are explicit.
Fixtures containing tokens in args, env, headers, URLs, and parse errors prove
that those values never reach responses or logs. Refresh and rendering start no
MCP process and make no MCP network request. There is no toggle, connection
test, or inline edit action in this read-only list; users edit its source via
the Configuration view.

### 5. Deliver recent sessions through the shared history module

Depends on Ticket 2 and Ticket 1's history contracts; can follow Ticket 4 without
making the earlier inventory delivery depend on it. Extract shared history,
add explicit global listing/read support for existing supported local sources,
and connect per-tool Recent sessions and a read-only transcript viewer.

Acceptance: sessions outside scanned projects appear; known projects link back
to Projects; missing transcript remains unavailable rather than synthesized
from cache; pagination is deterministic and source-scoped; archived/child/client
mode metadata is preserved where available. Antigravity/Gemini sessions report
unsupported. All existing project guidance review fixtures still pass,
including checkout confinement, legacy IDs, version checks, and mixed sources.
No session is resumed and no native history store is written.

### 6. Verify integration and document support

Depends on Tickets 2–5. Exercise the real web and Electron flows, including
inventory failure with Agent Tools still available, navigation state, manual
refresh, partial tool failure, representative resources, MCP projection, editor
launch, global sessions, and project review regressions. Use synthetic fixtures
for failure/security cases and local read-only smoke checks for native-format
confidence. Report unavailable local tools honestly.

Document the verified tool/version/capability matrix, configured roots,
unsupported formats, refresh behavior, local-host editor semantics, and session
limitations. V1 is complete when every in-scope capability verified in Ticket 1
is delivered and integration gates pass. Capability gaps stay explicit in the
support matrix; do not describe partial support as universal compatibility.

## Verification gates

- Focused new catalog/adapter/resource/MCP/session tests first. Inject filesystem,
  process-launch, and clock dependencies at useful seams; test caller-visible
  behavior rather than private helper structure.
- Run `npm test` (expanded to include new suites) and `npm run typecheck` for
  each completed implementation slice.
- Run `npm run build` for renderer/transport integration and final acceptance.
  This repository has no linter or CI; do not claim those checks.
- Run `npm run scan` when touching `core/`, `probes/`, or `rules/`, including
  shared type changes under `core/`, as required by the repository gate.
- Confirm parity through both HTTP and Electron IPC; a build is not interactive
  desktop evidence. Report separately deterministic tests, build/typecheck,
  runtime UI checks, actual editor launch, and sampled local tool discovery.
- Preserve unrelated work, especially the existing modified
  `inventory.config.json`. Never copy user config into fixtures, change
  annotations, hand-edit generated inventory/report files, or write Git history.

## Delivery checkpoints

After Ticket 4, the new section is independently useful: discover tools,
inspect global resources and MCP declarations, and open configuration files.
After Ticket 5, it also provides recent local sessions without tying its
ownership to Projects. Ticket 6 completes the agreed V1 and records its actual
support limits.
