# PRD 16 — Improve repository agent guidance from OpenCode history

Status: Draft for product review. No implementation is authorized by this document alone.

## Problem and outcome

Coding agents repeatedly spend time finding the same entry points, attempting unsuitable commands, and rediscovering repository conventions. Users correct these behaviors in conversations, but the corrections rarely become durable project instructions. Existing AGENTS.md guidance can also become inaccurate as a repository changes.

Add a separate review agent to Repo Inventory. For a selected project and user-selected OpenCode sessions, it examines the user's intent, the agent's actual actions, command outcomes, and user corrections. It proposes small, evidence-backed improvements to the root AGENTS.md. The user chooses individual edits and explicitly confirms the resulting change before the application writes it.

Success means more useful, accurate instructions with less repeated discovery and correction. Producing more instructions is not itself success. A review with no worthwhile edits is a valid outcome.

## Confirmed scope and proposed defaults

The user confirmed manual review of selected OpenCode sessions and editing only the selected checkout's root AGENTS.md, with creation when missing. History pages include short tool parameters and short errors automatically. V1 has no repository inspection tool or AGENTS.md content hashes. Session relevance and age are the user's choice; the application does not question or gate that choice.

Proposed defaults: use the existing configured Gemini credentials with a separately configured review model; use a dedicated native Vercel AI SDK ToolLoopAgent; persist review results locally. These are design recommendations, not additional confirmed preferences.

MVP includes session selection, paginated history, on-demand tool details, automatic inclusion of current AGENTS.md, evidence-backed suggestions, individual selection, confirmation, and conflict-safe application in both web and Electron modes.

Out of scope: repository inspection or freshness validation, AGENTS.md content hashing or whole-file version tracking, automatic or scheduled reviews, bulk cross-project reviews, other transcript providers, editing nested AGENTS.md or other instruction formats, source-code fixes, executing commands to reproduce historical failures, and automatic commits or pushes. No global user-preference memory is created.

## User experience

1. Open a project and choose “Improve agent guidance.” Show the exact checkout and target AGENTS.md path.
2. Display local OpenCode sessions with title, timestamps, directory, parent relationship, and available review history. The user selects sessions. Show related child sessions separately and let the user include them; never silently ignore or include their contents.
3. Before starting, identify the configured model and explain that selected transcript content and AGENTS.md are sent to that model provider. Show whether AGENTS.md exists.
4. During analysis, show progress such as sessions/pages inspected, tool details retrieved, and current phase. Allow cancellation. Report incomplete coverage clearly.
5. Present a short assessment of the original intent, observed friction, and available outcome evidence, followed by independent edit cards. Each card contains a title, rationale, evidence links, exact before/after text, and why the instruction should remain useful.
6. The user selects edits individually; none is preselected. “Apply selected edits” opens a combined diff for confirmation. Rejecting or leaving an edit unselected never writes it.
7. After confirmation, the application applies exactly that validated change and reports the file path and resulting state. If the original text or insertion anchor for a selected edit no longer matches uniquely, report a conflict and apply none of the selection. Unrelated changes elsewhere in the file do not invalidate the edits.

For a missing file, show that confirmation will create AGENTS.md. Each proposed addition remains independently selectable. Empty selection never creates an empty file.

## What the reviewer should learn

Useful recommendations include correcting an inaccurate description, pointing to the right module or specification, naming the supported verification command, documenting a recurring environment constraint with its conditions, and recording an explicit durable user correction.

The reviewer must distinguish observed facts, interpretation, and uncertainty. It must follow the user's intent as it changes through the conversation, distinguish an assistant's success claim from actual verification, and avoid treating a failed command as proof that the repository is broken.

One explicit project-wide correction can justify an edit. Repeated friction is stronger evidence for an inferred recommendation, but repetition alone does not prove its cause. A one-off task instruction, temporary outage, missing credential, or speculative workaround must not become an unconditional repository rule.

Use inline tool parameters and errors where sufficient, and retrieve additional tool details when needed to understand command behavior. Base recommendations on the selected transcripts and the supplied AGENTS.md. The reviewer does not inspect the repository or validate whether historical paths and commands remain current. The user chooses which sessions are useful and judges the proposed edits; old sessions require no warning, extra confirmation, or freshness check.

Prefer replacing or removing stale guidance over appending duplicates. Preserve useful existing wording. Do not rewrite the entire document for style, add generic advice, weaken safety rules merely because they impeded a historical run, or turn unrelated personal preferences into project rules.

## Agent context and tools

The application fixes the project, checkout, session selection, and target file for each run. Tools cannot switch scope through model-supplied project IDs or absolute paths. Initially include the selected session manifest and the exact root AGENTS.md snapshot or an explicit missing-file marker. Treat transcript and document text as evidence to analyze, not instructions granting capabilities to the reviewer.

| Tool | Input | Required behavior |
| --- | --- | --- |
| `read_session_history` | Session reference, optional cursor | Return a bounded page of ordered persisted steps, automatically including short tool parameters and short errors for failed calls. Omit successful output bodies and oversized payloads; provide detail references, continuation, and coverage metadata. Only selected sessions are accessible. |
| `read_tool_call` | Session reference, call reference, section (`input`, `output`, or `error`), optional cursor | Return the requested persisted payload in bounded chunks, preserving exact text and explicit availability status. |
| `propose_guidance_edits` | Structured assessment, coverage, and edit list | Validate and persist a reviewable proposal, returning its ID. Successful submission terminates analysis. An empty edit list is allowed with an explanation. This tool does not write AGENTS.md. |

Session listing belongs to the application selection interface. The agent already receives the selection, so it does not need an unrestricted session-discovery tool. A separate AGENTS.md tool is unnecessary because its content is included in initial context. The reviewer has no repository browsing or command-execution tools.

### History contract

“Full history” means all locally persisted records available for the selected sessions. It does not promise recovery of deleted, pruned, compacted-away, or never-persisted content.

Preserve user and assistant text, stored reasoning where available, step markers, errors, retries, compaction records, file/patch markers, and child-session references in their persisted order. Never manufacture hidden reasoning. Unknown part types receive explicit markers rather than being silently dropped. Large non-tool text is chunked with continuation references, not silently summarized or truncated. Binary attachments have metadata and an unsupported-content marker in MVP; do not embed them as text.

Tool timeline entries retain session/message/part IDs, tool call ID, name, status, timestamps when present, and payload availability. Include the complete serialized tool parameters automatically when they fit the inline size limit. For calls ending in error, also include the complete persisted error when it fits its inline size limit. Apply the limits independently, so oversized parameters do not hide a short error. Successful output bodies remain on demand.

Oversized parameters or errors receive an explicit omitted-for-size marker and a read_tool_call reference; do not silently truncate or generate summaries of them. Failed status is always visible even when the error is oversized or unavailable. Set documented inline limits during implementation and enforce the overall page-size bound by reducing page entries, not dropping qualifying inline fields. Preserve multiple invocations and retry order; do not collapse repeated failures into a single event.

Use an application-issued call reference incorporating session and part identity; do not assume a provider call ID is globally unique. Pagination uses opaque stable cursors and both record-count and response-size bounds. Return nextCursor, hasMore, and explicit missing/unsupported-content indicators. An oversized single record must remain retrievable across chunks.

Bind retrieval to a consistent source snapshot or detect source changes and invalidate the affected review. A timestamp cutoff alone is insufficient because existing records can change. The run must never silently mix versions of a tool payload. References link the model's evidence and the user's evidence viewer to the same content.

## Proposal and approval contract

Each persisted review records its project and canonical checkout, selected sessions and source versions, initial AGENTS.md contents or absence, model/settings, run status, coverage, limitations, assessment, edits, and user decisions.

Each edit records an application-issued ID, operation (insert/replace/delete), exact base location and old text, proposed text, rationale, category, evidence references. Evidence references must resolve to records actually retrieved during the run. This validates provenance, not whether the model's interpretation is correct; the UI must let the user inspect that evidence.

Edits must be individually meaningful and independently applicable against the same base snapshot. Overlapping or mutually dependent changes must be combined into a single coherent edit or returned for revision, not presented as independently selectable. The application computes the combined diff; the model does not generate a fresh patch after confirmation.

Approval is an application command bound to review ID and selected edit IDs with their exact persisted text changes. No AGENTS.md content hash or whole-file version token is required. It is not an agent tool. All selected changes are validated and applied as one file update; do not partially apply a selection.

Immediately before writing, read the current target and check target containment, file type, and existence. Require the exact old text for each replacement/deletion, or the exact context anchor for an insertion, to match uniquely. Reject missing or ambiguous matches without applying any selected edit. Apply the approved edits to the current contents, preserving unrelated changes; do not replace the file with the original snapshot plus edits. Serialize competing application writes for the same target across web/Electron paths. Use an atomic replacement and read back to verify the write. V1 does not implement whole-file version checking or coordination with external editors.

Never follow an AGENTS.md symlink for writing. Refuse unexpected file types. A repeated confirmation is idempotent and cannot append the same guidance twice. Persist enough application intent to reconcile a crash after the file write but before the review status update. Do not mark a write successful from model prose alone.

This feature introduces a narrow, explicitly approved repository-file write exception to the application's read-only purpose. It belongs in the guidance-review module, never in probes, rules, generated actions, or the scan pipeline. All Git safety constraints remain in force.

## Runtime and module design

Use the installed AI SDK's native ToolLoopAgent for tool execution and step progression. Do not implement a custom model/tool while-loop, invoke a coding CLI to perform the review, or inherit the general chat's command-execution tools. Native loop behavior and bounded context management are separate concerns: paginated tool responses alone do not prevent accumulated context growth.

Configure explicit step, time, and context budgets and support cancellation through the SDK. Record effective settings and token usage when available. The initial implementation must define and document concrete default limits before acceptance. Use SDK context preparation to retain intent, guidance, coverage, and evidence references while keeping the working context bounded; full evidence remains retrievable. Never claim exhaustive review because the loop stopped. Exhaustion, cancellation, provider failure, and invalid final output produce explicit incomplete/failed states, not an approvable completed review.

The guidance-review module exposes a small application interface: list sessions, start review, read review/progress, cancel review, and apply approved edits. InventoryService calls it through both Fastify and Electron IPC. New shared domain types belong in core/types.ts. The history reader owns OpenCode schema interpretation and pagination; the model prompt owns judgments about what constitutes useful guidance; deterministic application code owns scope, provenance, and file mutation.

Persist review state in private, gitignored application storage separate from inventory.json and annotations.json. Retain proposal evidence excerpts and hashes so a review remains understandable if the source disappears; do not copy the entire OpenCode database. Support deleting stored reviews and their evidence. Restarting the app preserves submitted proposals and decisions; interrupted analysis becomes interrupted rather than silently restarting or applying changes.

## OpenCode integration evidence and implementation decision

On 2026-09-06, local read-only inspection confirmed ~/.local/share/opencode/opencode.db exists and contains session, message, and part tables. Session records contain project/directory and parent-session fields; messages and parts contain IDs, timestamps, and JSON data. A limited sample included text, tool, reasoning, step-start, step-finish, file, and patch parts. This establishes feasibility, not universal schema compatibility or payload completeness.

OpenCode also documents session commands and JSON export, plus a server interface. Proposed MVP approach: a version-checked, read-only local SQLite reader behind the history interface, because bounded local retrieval is central to this feature. Resolve the configured/default source explicitly; never scan arbitrary databases or assume the observed path applies on every machine. Keep schema-specific code isolated, never migrate or write OpenCode storage, and report unsupported schema versions clearly. Before implementation commits to this approach, validate representative exports/records against the installed OpenCode version, especially tool payloads, compaction, and child sessions.

Associate sessions using canonical checkout directories and verified worktree relationships. Inventory project IDs and OpenCode project IDs are different identity systems. A matching remote alone cannot authorize another checkout's history or edits. Renamed/deleted/ambiguous directories require explicit user association. The UI exposes additional OpenCode sources as a future extension, not automatic database discovery in MVP.

References: [OpenCode CLI](https://opencode.ai/docs/cli/), [OpenCode server](https://opencode.ai/docs/server/), [Vercel ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent). The installed package declarations confirm ToolLoopAgent and isStepCount; implementation must follow the installed SDK version rather than copying potentially older documentation examples.

## Acceptance criteria

1. A user can select one or more sessions associated with a project and start a dedicated review in web and Electron modes. Unselected/unrelated sessions are inaccessible to its tools.
2. A transcript fixture containing user corrections, repeated tool failures, compaction, large text, and child-session markers is retrievable without omitted or duplicated available steps across pages. Short tool parameters and short errors appear automatically; successful outputs and oversized parameters/errors do not. Failed calls remain identifiable when their error body is omitted. Verify payloads at and above the documented inline limits and ensure page bounds hold.
3. Each call reference retrieves the matching input, output, or error, including chunked oversized payloads. Missing/pruned payloads are explicitly unavailable. Malformed records and unsupported schemas cause clear bounded failures.
4. Evidence-based scenarios cover a durable correction, a corrected pointer supported by the selected transcript, a temporary environment failure that must not become a global rule, an already-covered instruction, and a legitimate no-change result. An old session is accepted without repository inspection or freshness gating.
5. A valid proposal cites retrieved evidence, shows exact independent edits, and reports coverage and uncertainty. Fabricated references, overlapping edits, and invalid anchors are rejected.
6. Selecting a subset changes only that subset after confirmation. Rejection, empty selection, cancellation, and unsuccessful analysis never modify AGENTS.md.
7. Missing AGENTS.md can be created after confirmation; a file appearing after review conflicts. Missing or ambiguous edit anchors, symlinks, moved checkouts, and invalid file types are rejected. Unrelated changes elsewhere in AGENTS.md are preserved and do not block application. No AGENTS.md hashes are generated or compared.
8. Retry and crash-recovery cases cannot duplicate edits or report an unverified write as successful. Concurrent app requests are serialized and approvals with mismatched edit anchors fail.
9. Transcript instructions attempting to invoke execution tools or change scope cannot gain those capabilities. Tool responses and retained evidence are bounded and confined to the authorized project/session selection.
10. Provider errors, unavailable history, exhausted budgets, and application restart produce distinguishable states. Submitted proposals survive restart without automatic application.

Use focused interface-level tests for retrieval and approved writes, plus a disposable-project end-to-end exercise in both transports and one real-provider review before claiming live behavior. The repository currently has no test suite; select the smallest suitable harness during implementation. npm run typecheck remains required. Run npm run scan only if core, probes, or rules are changed.

## Evaluation and delivery

Track completed/incomplete reviews, evidence coverage, accepted/rejected edits, conflicts, elapsed time, and token usage when supplied. These describe usability and cost, not proof of improved coding efficiency. Evaluate that outcome with user feedback and later comparable sessions: did the same navigation mistakes or corrections recur? Establish a baseline before assigning numerical improvement targets.

Deliver in three slices: (1) project-scoped history selection and evidence browsing; (2) the native review loop producing validated, persisted proposals; (3) individual selection, exact confirmation, and verified AGENTS.md writes in both transports. Each slice should work end to end within its scope. The feature is complete only when all three satisfy the acceptance criteria.
