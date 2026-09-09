# Agent Tools V1 Capability Matrix and Discovery Specification

Date: 2026-09-08  
Status: Frozen specification for Ticket 1 FIX stage and Ticket 2+ implementation  

## 1. Overview and Scope

This document specifies the verified capability matrix, configuration paths, discovery behaviors, launcher contracts, bounds, and parser rules for the 5 known agent tools in the Agent Tools feature:
1. **Codex** (`codex`)
2. **OpenCode** (`opencode`)
3. **Claude Code** (`claude`)
4. **Antigravity** (`antigravity`)
5. **Gemini CLI** (`gemini`)

The Agent Tools feature manages machine-level tool inventory, global configuration, global skills, sub-agent definitions, global instructions, and read-only MCP server declarations. It is completely isolated from the repository-level **Projects** inventory.

---

## 2. Verified Capability Matrix

| Capability | Codex | OpenCode | Claude Code | Antigravity | Gemini CLI |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CLI Command** | `codex` | `opencode` | `claude` | `agy` | `gemini` |
| **Desktop / App** | `/Applications/Codex.app` | `/Applications/OpenCode.app` | `/Applications/Claude.app` | `/Applications/Antigravity.app` | None (CLI only) |
| **Global Root** | `~/.codex` | `~/.config/opencode` (or `~/.opencode`) | `~/.claude`<br>`~/Library/Application Support/Claude` | `~/.gemini/antigravity` | `~/.gemini` |
| **Config Format** | TOML (`config.toml`) | JSONC (`opencode.json`) | JSONC (`~/.claude.json`, `claude_desktop_config.json`) | JSON / Config (`config.json`) | JSON / Config (`config.json`) |
| **Skills** | `ready` | `ready` | `ready` | `ready` | `ready` |
| **Subagents** | `ready` | `ready` | `unsupported` | `unsupported` | `unsupported` |
| **Instructions** | `ready` | `ready` | `ready` | `ready` | `ready` |
| **MCP Servers** | `ready` | `ready` | `ready` | `ready` | `ready` |
| **Configuration** | `ready` | `ready` | `ready` | `ready` | `ready` |
| **Recent Sessions** | `ready` | `ready` | `ready` | `unsupported` | `unsupported` |

### Capability State Definitions and Explicit Reasons

- **`ready`**: Supported by verified format evidence. If no items exist in a supported location, returns an empty array with state `ready`.
- **`missing`**: Discovered configuration reference or target file is absent on disk (e.g. tool is not installed or optional instructions file was not created).
- **`unsupported`**: Capability is not supported in V1. Explicit reasons:
  - **Claude Code Subagents**: `"Claude Code does not define standalone global sub-agent definition files in V1."`
  - **Antigravity Subagents**: `"Antigravity sub-agent definitions are managed via internal workspaces and protocol buffers; standalone file format is outside V1 scope."`
  - **Gemini CLI Subagents**: `"Gemini CLI does not provide standalone global sub-agent definition files in V1."`
  - **Antigravity Sessions**: `"Antigravity sessions unsupported in V1 because native session decoders (SQLite binary blobs / protocol buffers) are outside V1 scope."`
  - **Gemini CLI Sessions**: `"Gemini CLI sessions unsupported in V1 because native session decoders are outside V1 scope."`
- **`error`**: An unexpected failure occurred during file reading, traversal, or parsing (e.g. malformed syntax, permission denial).

---

## 3. Tool-by-Tool Specification

### 3.1 Codex (`codex`)
- **Tool Identifier**: `codex`
- **Display Name**: `Codex`
- **macOS Identities & Resolution**:
  - CLI binary: `codex`
  - Candidate binary paths: `/usr/local/bin/codex`, `/opt/homebrew/bin/codex`, `~/.codex/bin/codex`, `~/.cargo/bin/codex`, `PATH` lookup.
  - App bundle: `/Applications/Codex.app`
  - Version probe: `codex --version` (timeout: 2500ms).
- **Global Roots & Files**:
  - Global root: `~/.codex`
  - Primary configuration: `~/.codex/config.toml` (parsed using `parseToml`).
- **Skills**:
  - Directory: `~/.codex/skills/`
  - Format: Subdirectories containing `SKILL.md` or instruction documentation.
  - Activation: Enabled by default, or reflected via `plugins."openai@skills"` table.
- **Sub-agents**:
  - State: `ready`; definitions are direct, non-hidden `*.toml` files in `~/.codex/agents/` (and configured Codex roots' `agents/` directories).
  - Required TOML string fields: `name`, `description`, and `developer_instructions`.
  - Optional displayed metadata: `model`, `model_reasoning_effort`, and `sandbox_mode`.
  - Previews are plain-text allowlisted projections containing only those fields and `developer_instructions`; nested MCP/session configuration is never returned.
  - Historical spawned child threads remain Recent Sessions and are not treated as definitions.
  - See the [OpenAI custom agents documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents).
- **Instructions**:
  - User instructions: `~/.codex/instructions.md` or `~/.codex/AGENTS.md`.
- **MCP Servers**:
  - Declaration location: `~/.codex/config.toml` under `[mcp_servers.<name>]`.
  - Transport mapping:
    - If `command` is present: `stdio` (arguments mapped to `args`).
    - If `url` is present: `sse` or `http`.
    - Otherwise: `unknown`.
  - Enablement: Enabled unless explicit `enabled = false` is declared.
- **Recent Sessions**:
  - State: `ready`. Rollout history storage via SQLite `state_5.sqlite` and session JSONL at `~/.codex/sessions/`.

---

### 3.2 OpenCode (`opencode`)
- **Tool Identifier**: `opencode`
- **Display Name**: `OpenCode`
- **macOS Identities & Resolution**:
  - CLI binary: `opencode`
  - Candidate binary paths: `/usr/local/bin/opencode`, `/opt/homebrew/bin/opencode`, `~/.local/bin/opencode`, `PATH` lookup.
  - App bundle: `/Applications/OpenCode.app`
  - Version probe: `opencode --version` (timeout: 2500ms).
- **Global Roots & Files**:
  - Global root: `~/.config/opencode` (fallback: `~/.opencode`).
  - Primary configuration: `~/.config/opencode/opencode.json` (or `~/.opencode/opencode.json`, parsed using `parseJsonc`).
- **Skills**:
  - Directory: `~/.config/opencode/skills/`
  - Format: Skill folders containing doc files or metadata.
- **Sub-agents**:
  - State: `ready`.
  - Directory: `~/.config/opencode/agents/`
  - Format: JSON or Markdown agent definitions with model/tool restrictions.
- **Instructions**:
  - Global instructions: `~/.config/opencode/INSTRUCTIONS.md` or `~/.config/opencode/AGENTS.md`.
- **MCP Servers**:
  - Declaration location: `opencode.json` under `mcp.servers.<name>`.
  - Transport mapping:
    - If `command` is present: `stdio`.
    - If `url` is present: `sse` or `http`.
  - Enablement: Enabled unless `enabled: false`.
- **Recent Sessions**:
  - State: `ready`. Discovered from `~/.local/share/opencode/sessions/` or `~/.config/opencode/sessions/`.

---

### 3.3 Claude Code (`claude`)
- **Tool Identifier**: `claude`
- **Display Name**: `Claude Code`
- **macOS Identities & Resolution**:
  - CLI binary: `claude`
  - Candidate binary paths: `/usr/local/bin/claude`, `/opt/homebrew/bin/claude`, `~/.npm-global/bin/claude`, `PATH` lookup.
  - App bundle: `/Applications/Claude.app` (Claude Desktop).
  - Version probe: `claude --version` (timeout: 2500ms).
- **Global Roots & Files**:
  - Global roots: `~/.claude` (CLI) and `~/Library/Application Support/Claude` (Desktop).
  - Primary configuration:
    - CLI: `~/.claude.json`
    - Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json` (parsed using `parseJsonc`).
- **Skills**:
  - Directory: `~/.claude/skills/`
- **Sub-agents**:
  - State: `unsupported` (reason: no standalone definition schema verified in V1).
- **Instructions**:
  - Global user instructions: `~/.claude/CLAUDE.md`.
- **MCP Servers**:
  - Declaration location: `claude_desktop_config.json` under `mcpServers.<name>` or `~/.claude.json`.
  - Transport mapping:
    - `command` + `args`: `stdio`.
    - `url`: `sse` or `http`.
  - Enablement: Enabled by default.
- **Recent Sessions**:
  - State: `ready`. Supported via Claude project cache adapters and Cowork session stores.

---

### 3.4 Antigravity (`antigravity`)
- **Tool Identifier**: `antigravity`
- **Display Name**: `Antigravity`
- **macOS Identities & Resolution**:
  - CLI binary: `agy`
  - Candidate binary paths: `/usr/local/bin/agy`, `/opt/homebrew/bin/agy`, `~/.gemini/antigravity/bin/agy`, `~/.antigravity/bin/agy`, `PATH` lookup.
  - App bundle: `/Applications/Antigravity.app`
  - Version probe: `agy --version` (timeout: 2500ms).
- **Global Roots & Files**:
  - Global root: `~/.gemini/antigravity`
  - Primary configuration: `~/.gemini/antigravity/config.json` or `settings.json`.
- **Skills**:
  - Directory: `~/.gemini/antigravity/skills/`
- **Sub-agents**:
  - State: `unsupported` (reason: internal protobuf workspace definitions outside V1 scope).
- **Instructions**:
  - Global user instructions: `~/.gemini/antigravity/instructions.md` or `GLOBAL_INSTRUCTIONS.md`.
- **MCP Servers**:
  - Declaration location: `~/.gemini/antigravity/mcp/` or `config.json`.
  - Transport mapping: `stdio` (for command) or `sse`/`http` (for URL).
- **Recent Sessions**:
  - State: `unsupported` (reason: native session decoders for SQLite binary payloads / `.pb` files are outside V1 scope).

---

### 3.5 Gemini CLI (`gemini`)
- **Tool Identifier**: `gemini`
- **Display Name**: `Gemini CLI`
- **macOS Identities & Resolution**:
  - CLI binary: `gemini`
  - Candidate binary paths: `/usr/local/bin/gemini`, `/opt/homebrew/bin/gemini`, `~/.gemini/bin/gemini`, `PATH` lookup.
  - App bundle: None (`appPath: null`).
  - Version probe: `gemini --version` (timeout: 2500ms).
- **Global Roots & Files**:
  - Global root: `~/.gemini`
  - Primary configuration: `~/.gemini/config.json` or `~/.gemini/settings.json`.
- **Skills**:
  - Directory: `~/.gemini/skills/`
- **Sub-agents**:
  - State: `unsupported` (reason: no standalone definition schema verified in V1).
- **Instructions**:
  - Global user instructions: `~/.gemini/GEMINI.md`.
- **MCP Servers**:
  - Declaration location: `~/.gemini/mcp.json` or `config.json`.
  - Transport mapping: `stdio` or `sse`/`http`.
- **Recent Sessions**:
  - State: `unsupported` (reason: native session decoders outside V1 scope).

---

## 4. Safe External Launcher Rules

To prevent command injection, privilege escalation, and unintended file modifications:

1. **Strict Non-Shell Invocation**:
   - Never use `child_process.exec` or any launcher with `{ shell: true }`.
   - All invocations must use `spawn` with an allowlisted executable and explicit string arguments array.

2. **Allowlisted macOS Launcher (`/usr/bin/open`)**:
   - **Editor action** (`action: "editor"`):
     ```ts
     spawn("/usr/bin/open", ["-t", canonicalPath], { shell: false });
     ```
     Opens the target file in the user's default text editor.
   - **Reveal action** (`action: "reveal"`):
     ```ts
     spawn("/usr/bin/open", ["-R", canonicalPath], { shell: false });
     ```
     Reveals the target file in macOS Finder.

3. **Backend-Issued Reference Confinement**:
   - Callers pass a reference token (`ref`), never an arbitrary filesystem path.
   - The backend resolves `ref` against its currently discovered `ConfigurationReference` map.
   - Any unknown `ref` is immediately rejected.

4. **Filesystem Re-Verification Before Launch**:
   - Target path is checked before calling `open`:
     - Must resolve to a canonical realpath (`fs.realpath`).
     - Must exist and be a regular file (`stats.isFile()`).
     - Must not escape approved root directory boundaries.
   - If the file has changed or disappeared, return an actionable `{ ok: false, message: "..." }` result without launching.

5. **Remote Environment Awareness**:
   - If running in a headless or remote server environment where UI launching is unavailable, return an informative error indicating that local editors cannot be opened from a remote browser session, and provide the file path for copying.

---

## 5. Numerical Bounds and Traversal Limits

Hard bounds prevent runaway traversal, memory exhaustion, and latency spikes. All discovery adapters must adhere to the constants exported in `server/agentTools/bounds.ts`:

```ts
export const MAX_PREVIEW_BYTES = 256_000;    // 256 KB max preview payload
export const MAX_RESOURCE_ITEMS = 100;       // Max skills / subagents / instructions per tool
export const MAX_MCP_SERVERS = 100;          // Max MCP server declarations per tool
export const MAX_SESSIONS_PER_TOOL = 50;     // Max recent session summaries per tool
export const PROBE_TIMEOUT_MS = 2500;        // Max duration for CLI probes / child processes
```

### Traversal and Symlink Rules
- **Symlink Traversal**: Only follow symlinks from within supported tool root directories. Record both the discovery path and the `canonicalId` (`realpath`).
- **Loop Detection**: Maintain a set of visited inode / canonical paths to avoid cyclic directory references.
- **Depth Limit**: Restrict skill and sub-agent directory traversal to a maximum depth of 3 below the root.
- **Redaction of Sensitive Data**:
  - MCP configurations containing API tokens, passwords, authorization headers, private keys, or credentials must never be exposed across HTTP/IPC boundaries.
  - Return only server name, recognized transport (`stdio` | `sse` | `http` | `unknown`), state (`enabled` | `disabled`), source configuration reference, and duplicate/conflict indicators.

---

## 6. Configuration Parser Specifications

### 6.1 TOML Parser (`server/agentTools/toml.ts`)
- Pure zero-dependency TOML 1.0 parser implemented in TypeScript.
- Supports:
  - Key/value pairs with bare keys, quoted keys, and dotted keys.
  - Primitive types: booleans, signed/unsigned integers, floats (including exponents and underscores), hex/octal/binary notations.
  - Strings: basic with escapes (`\"`, `\n`, `\t`, `\uXXXX`), literal (`'...'`), multiline basic (`"""..."""`), multiline literal (`'''...'''`).
  - Tables: standard tables (`[table]`), dotted tables (`[a.b.c]`), inline tables (`{ x = 1, y = 2 }`).
  - Arrays: multi-line arrays with trailing commas and mixed whitespace.
  - Array of tables (`[[table]]`).
- Error Handling:
  - Throws descriptive syntax errors containing line and column numbers.
  - `safeParseToml(text)` provides safe result tuples `{ ok: true, data } | { ok: false, error }`.

### 6.2 JSONC Parser (`server/agentTools/jsonc.ts`)
- Implemented using `json5`.
- Supports:
  - Single-line comments (`// ...`) and multi-line comments (`/* ... */`).
  - Trailing commas in objects and arrays.
  - Unquoted property identifiers and single-quoted strings.
- Error Handling:
  - Provides `parseJsonc(text)` (throws descriptive `JSONC parse error: <msg>`) and `safeParseJsonc(text)` returning `{ ok: true, data } | { ok: false, error }`.

---

## 7. Refresh Behavior & Caching Semantics

### 7.1 In-Memory Caching in `AgentToolsCatalog`
- Machine-level tool discovery, version probing, configuration file resolution, and global resource indexing are cached in memory inside `AgentToolsCatalog`.
- Once initial discovery completes, subsequent queries (`listTools`, `getToolDetails`, `lookupRef`, `readResource`) read from `this.cache` and `this.resourceIndex` synchronously without repeated filesystem scans or child process executions.

### 7.2 Concurrent Request Coalescing
- When a discovery probe is in flight, any simultaneous caller shares the active `this.inFlight` Promise.
- This coalescing eliminates redundant filesystem traversal, avoids spawning concurrent duplicate CLI probes, and prevents race conditions during cold start or multi-tab browser sessions.
- Once the in-flight probe resolves or rejects, `this.inFlight` resets to `null`.

### 7.3 Manual Refresh Lifecycle
- Manual refresh via `POST /api/agent-tools/refresh` (HTTP) or `agentTools:refresh` (Electron IPC) invalidates backend caches:
  - Clears `this.cache = null`
  - Clears `this.inFlight = null`
  - Clears `this.resourceIndex.clear()`
- Forces a complete re-scan of configured tool roots, re-probing of CLI binary versions, re-indexing of skills/subagents/instructions, and fresh parsing of configuration files.
- **Section Isolation**: Refreshing Agent Tools does not trigger a repository scan in Projects. Conversely, running repository inventory scans in Projects does not invalidate or trigger an Agent Tools refresh.

---

## 8. Local-Host Editor Semantics & Remote Web Fallback

### 8.1 Host Process Execution
- File opener and reveal operations (`openConfiguration`) execute on the host machine hosting the Node.js / Electron server process.
- The invocation is executed by the host operating system launcher (`/usr/bin/open` on macOS) and does not execute in the client web browser sandbox.

### 8.2 Remote Web Fallback & "Copy Path"
- In web browser mode connecting to a remote host (e.g. headless development server or cloud VM), clicking "Open in Editor" launches the editor on the remote host desktop, which may not be visible to the remote user.
- To provide a seamless workflow for remote client environments, the UI provides an explicit "Copy Path" action for every discovered configuration and instruction file. Users can copy the resolved canonical path to the clipboard and open it in their local remote-development workspace (e.g., VS Code Remote SSH, Tramp, or terminal).

### 8.3 Argument Vector Safety and Canonical Verification
To prevent command injection, privilege escalation, and unintended file access:
- **Strict Non-Shell Invocation**: `spawn(launcher, args, { shell: false })` is used unconditionally. No shell interpreter is ever invoked.
- **Allowlisted Argument Vectors**:
  - Editor action: `spawn("/usr/bin/open", ["-t", canonicalPath], { shell: false })`
  - Reveal action: `spawn("/usr/bin/open", ["-R", canonicalPath], { shell: false })`
- **Reference Resolution & Path Confinement**:
  - The backend only accepts backend-issued configuration references (`ref`), never arbitrary user-supplied filesystem paths.
  - The referenced item must have `kind: "configuration"` or `kind: "instruction"`. Skill and sub-agent references are explicitly ineligible for the opener.
  - Prior to launching, the backend asserts that:
    1. The target file exists (`existsSync`).
    2. The target is a regular file (`statSync(path).isFile()`).
    3. The resolved canonical path matches the recorded canonical path (`realpathSync(path) === item.canonicalPath`), preventing symlink race or retargeting attacks.

---

## 9. Session History Constraints & Safety Limitations

### 9.1 Read-Only Invariant in V1
- All session history operations in Agent Tools are 100% read-only.
- V1 does NOT support:
  - Resuming or branching sessions.
  - Modifying native session records, SQLite databases, or JSONL files.
  - Triggering agent completions, prompt evaluations, or running bash commands from past sessions.
  - Deleting or editing historic transcripts.

### 9.2 Truthful Transcript Reporting
- The transcript viewer strictly reflects persisted disk records:
  - If a transcript file is deleted, missing, or corrupt, the backend reports `available: false` with `"Local transcript unavailable."` rather than synthesizing placeholder dialogue or assuming success.
  - Unrecognized session identifiers or disabled history sources return clean unavailable states without crashing the host process.

### 9.3 Confinement and Boundaries
- Project-Scoped Guidance Review:
  - Project review endpoints (`/api/guidance/history`) continue to enforce strict project checkout confinement. Accessing a session directory outside the specified checkout is rejected with an actionable boundary error.
- Agent Tools Global History:
  - The Agent Tools session viewer retrieves transcripts via `getGlobalHistory` across all supported local sources (OpenCode, Codex, Claude Code, Cowork) without checkout confinement.
  - Project association is explicitly labeled (`known_project`, `external_folder`, or `projectless`).
- Numerical Bounds:
  - `MAX_SESSIONS_PER_TOOL = 50`: Recent session listing is bounded to the 50 most recent sessions per tool.
  - `PAGE_ENTRIES = 50` and `PAGE_BYTES = 512_000`: Transcript pagination bounds prevent memory exhaustion when rendering large session histories.

---

## 10. Verified Versions & Unsupported Formats Summary

### 10.1 Verified Version Probe Baselines
- **Codex (`codex`)**:
  - Tested version probe: `codex --version` (`codex-cli 0.152.0+`).
  - Configuration: `~/.codex/config.toml` (TOML format with `[mcp_servers.<name>]` and `[[plugins]]`).
  - Sessions: SQLite `state_5.sqlite` metadata and rollout session JSONL files under `~/.codex/sessions/`.
- **OpenCode (`opencode`)**:
  - Tested version probe: `opencode --version` (`opencode 1.18.x+`).
  - Configuration: `~/.config/opencode/opencode.json` (JSONC format with `mcp.servers` object).
  - Subagents: `~/.config/opencode/agents/*.json` definitions.
  - Sessions: SQLite `opencode.db` (`session`, `message`, and `part` tables).
- **Claude Code (`claude`)**:
  - Tested version probe: `claude --version` (`2.1.x (Claude Code)`).
  - Configuration: Desktop `~/Library/Application Support/Claude/claude_desktop_config.json` (JSONC with `mcpServers`), CLI `~/.claude.json`.
  - Sessions: Discovered via Claude project cache `.session_cache.json` and Cowork local directories.
- **Antigravity (`antigravity`)**:
  - Tested identities: App bundle `/Applications/Antigravity.app`, CLI `agy --version`.
  - Global roots: `~/.gemini/antigravity/` (configuration, skills, instructions, MCP declarations).
- **Gemini CLI (`gemini`)**:
  - Tested version probe: `gemini --version`.
  - Global roots: `~/.gemini/` (configuration, skills, instructions, MCP declarations).

### 10.2 Unsupported Format Rationale
- **Codex Subagents**: Codex does not define standalone global sub-agent definition files in V1; historical child threads are stored as sessions rather than reusable definitions.
- **Claude Code Subagents**: Claude Code does not provide standalone global sub-agent configuration files in V1.
- **Antigravity Subagents**: Antigravity sub-agent definitions are managed via internal workspaces and protocol buffer definitions outside the scope of V1 standalone file discovery.
- **Gemini CLI Subagents**: Gemini CLI does not expose standalone sub-agent definition files in V1.
- **Antigravity & Gemini Recent Sessions**: Native session decoders for Antigravity (internal SQLite binary blobs and protobufs) and Gemini CLI are outside the scope of V1.

