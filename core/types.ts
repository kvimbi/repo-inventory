/**
 * Core type contracts.
 *
 * Three separate concerns, deliberately kept apart:
 *
 *   Facts       — observed from the filesystem. Recomputed on every scan. Never authored by hand.
 *   Annotations — authored by you in the dashboard. Persisted forever. Never touched by a scan.
 *   Flags       — derived from Facts + Annotations by rules. Pure functions, cheap to change.
 *
 * Probes, rules and actions are the extension points. Drop a file into
 * `probes/`, `rules/` or `actions/` and it is picked up automatically.
 */

export type ProjectKind = "repo" | "worktree" | "submodule" | "orphan";

/** Where a project sits relative to the scan root. */
export interface ProjectLocation {
  /** Absolute path on disk. */
  path: string;
  /** Path relative to the scan root, e.g. `tmp/studio_resco`. */
  relPath: string;
  /** Leaf folder name. */
  name: string;
  /** First path segment under the root, used for grouping, e.g. `tmp`. */
  group: string;
  /** relPath of the nearest ancestor project, if this project is nested inside another. */
  nestedIn: string | null;
  /** Directory nesting depth below the root. */
  depth: number;
  /** Scan root directory containing this project. */
  rootDir?: string;
}

/** An agentic skill found inside a repository (e.g. under `.agents/skills`). */
export interface AgentSkill {
  /** Identifier/name of the skill. */
  name: string;
  /** Relative path from repository root, e.g. `.agents/skills/deploy-helper`. */
  relPath: string;
  /** Short summary of what the skill does, extracted from frontmatter or lead paragraph. */
  description?: string;
  /** Relative path to the markdown doc/instruction file if present, e.g. `.agents/skills/deploy-helper/SKILL.md`. */
  docFile?: string;
}

/**
 * Everything a scan observed about one project.
 *
 * Probes contribute the optional fields. A probe that cannot say anything about
 * a project simply returns nothing, so absent data stays `undefined` rather than
 * being faked with a zero.
 */
export interface ProjectFacts extends ProjectLocation {
  /** Stable identity that survives the folder being moved or renamed. */
  id: string;
  kind: ProjectKind;

  // --- git identity (probe: git-basics) ---
  isGit?: boolean;
  branch?: string | null;
  /** True when HEAD is not on any branch. */
  detached?: boolean;
  branchCount?: number;
  hasRemote?: boolean;
  remoteName?: string | null;
  remoteUrl?: string | null;
  /** Host extracted from the remote URL, e.g. `github.com`. */
  remoteHost?: string | null;
  /** Remote's default branch, when git knows it. */
  defaultBranch?: string | null;
  /** Root (first) commit SHA of the repository. */
  rootCommitSha?: string | null;
  /** Current HEAD commit SHA. */
  headCommitSha?: string | null;

  // --- duplicates (correlation in scan) ---
  /** relPaths of other projects sharing the same remote URL or git history. */
  duplicateOf?: string[];
  /** True when this project is considered a duplicate copy rather than the canonical project. */
  isDuplicateCopy?: boolean;

  // --- git sync state (probe: git-sync) ---
  /** Commits on the current branch not on its upstream. */
  ahead?: number;
  /** Commits on the upstream not on the current branch. */
  behind?: number;
  /** True when the current branch has no configured upstream. */
  noUpstream?: boolean;
  /** Tracked files with modifications, staged or not. */
  dirtyFiles?: number;
  untrackedFiles?: number;
  stashes?: number;
  /** Local branches that have no upstream at all, i.e. exist only here. */
  localOnlyBranches?: string[];
  /** Last time the remote was fetched, ISO 8601. Tells you how stale ahead/behind is. */
  lastFetchAt?: string | null;

  // --- history (probe: git-activity) ---
  lastCommitAt?: string | null;
  lastCommitSubject?: string | null;
  /** Whole days since the last commit. */
  lastCommitAgeDays?: number | null;
  commits30d?: number;
  commits90d?: number;
  commitsTotal?: number;
  commitCount?: number;
  authors?: string[];
  /** Newest mtime of any non-ignored file. Catches work that was never committed. */
  lastTouchedAt?: string | null;
  lastTouchedAgeDays?: number | null;

  // --- tech stack (probe: stack) ---
  /** Coarse ecosystems, e.g. `node`, `python`, `dotnet`. */
  stack?: string[];
  /** Notable frameworks and tools, e.g. `react`, `nx`, `fastapi`. */
  frameworks?: string[];
  /** Manifest files that produced the stack verdict, relative to the project. */
  manifests?: string[];
  /** True when the project is a monorepo workspace root. */
  isMonorepo?: boolean;
  packageCount?: number;
  projectType?: "standalone" | "monorepo-root" | "sub-project";
  isSubProject?: boolean;
  monorepoRootId?: string;
  subProjectCount?: number;
  subProjectPaths?: string[];

  // --- agent tooling (probe: agent-tooling) ---
  /** Agent config found in the repo, e.g. `claude`, `opencode`, `agents.md`. */
  agentTooling?: string[];

  // --- agent skills (probe: agent-skills) ---
  /** Agent skills found in the repo (e.g. under `.agents/skills`). */
  skills?: AgentSkill[];

  // --- footprint (probe: footprint) ---
  /** Bytes of source, i.e. excluding pruned dirs like node_modules. */
  sourceBytes?: number;
  /** Bytes reclaimable by deleting build and dependency dirs. */
  disposableBytes?: number;
  sourceFiles?: number;
  hasReadme?: boolean;

  /** Anything a probe wants to attach without extending this interface. */
  extra?: Record<string, unknown>;
}

export type FlagSeverity = "critical" | "warn" | "info" | "good";

export interface Flag {
  rule: string;
  severity: FlagSeverity;
  label: string;
  /** One-line explanation with the concrete numbers filled in. */
  detail?: string;
}

export type ProjectStatus = "active" | "stale" | "obsolete" | "archived" | "unknown";

/** Your authored view of a project. The only mutable-by-hand data in the system. */
export interface Annotation {
  status: ProjectStatus;
  note: string;
  /** ISO date. While in the future, rule flags are suppressed for this project. */
  snoozedUntil: string | null;
  /** Whether the project is marked as a favourite for quick access. */
  favourite?: boolean;
  /** Custom alias / display name override for the project. */
  alias?: string | null;
  /** Rule names explicitly suppressed for this project (e.g. ["LOCAL_ONLY"]). */
  suppressedFlags?: string[];
  /** Whether the project is marked as requiring action (todo). */
  todo?: boolean;
  updatedAt: string;
  /** Last known relPath, so a moved project can be reconciled by hand if needed. */
  lastSeenAt?: string;
}

/** A project as the dashboard sees it: facts + your annotation + derived flags. */
export interface Project extends ProjectFacts {
  annotation: Annotation;
  flags: Flag[];
  /** Highest severity among non-suppressed flags, for sorting. */
  risk: number;
  /** True when flags were suppressed by status or snooze. */
  suppressed: boolean;
}

export interface ScanProgress {
  phase: "starting" | "discovering" | "probing" | "evaluating" | "refreshing" | "ready";
  done?: number;
  total?: number;
  current?: string;
  message?: string;
}

export interface Inventory {
  version?: number;
  root: string;
  roots?: string[];
  scannedAt: string;
  /** True when the scan contacted remotes, so ahead/behind is fresh. */
  fetched: boolean;
  durationMs: number;
  projects: Project[];
  probes: string[];
  rules: RuleMeta[];
  actions: ActionMeta[];
}

// --- agent guidance review ---

export type GuidanceReviewStatus = "draft" | "running" | "completed" | "incomplete" | "failed" | "cancelled" | "applying" | "applied" | "conflict";
export type GuidanceEditOperation = "insert" | "replace" | "delete";

export interface GuidanceSessionSummary {
  id: string;
  /** Stable local-history provider key; session IDs are opaque and source-qualified. */
  sourceId: string;
  /** Human-readable provenance, independent of the configured review model. */
  client: "OpenCode" | "Claude Code" | "Claude Desktop Code" | "Claude Cowork (local)" | "Codex";
  title: string;
  directory?: string;
  parentId: string | null;
  createdAt?: string;
  updatedAt?: string;
  relatedChild: boolean;
  sourceVersion: string;
  available?: boolean;
  unavailableReason?: string;
  limitations?: string;
}

export interface GuidanceHistorySourceDiagnostic {
  id: string;
  state: "ready" | "missing" | "unsupported" | "error" | "disabled";
  reason?: string;
}

export interface GuidanceSessionList {
  sessions: GuidanceSessionSummary[];
  sources: GuidanceHistorySourceDiagnostic[];
}

export interface GuidanceHistoryEntry {
  id: string;
  sessionId: string;
  messageId: string;
  partId: string;
  /** Native branch ancestry where the history client records it. */
  parentId?: string;
  createdAt?: string;
  role?: "user" | "assistant";
  type: string;
  text?: string;
  tool?: {
    callRef: string;
    name: string;
    status: string;
    input?: string;
    inputOmitted?: boolean;
    error?: string;
    errorOmitted?: boolean;
    outputAvailable: boolean;
  };
  unavailable?: string;
}

export interface GuidanceHistoryPage {
  entries: GuidanceHistoryEntry[];
  nextCursor?: string;
  hasMore: boolean;
  sourceVersion: string;
  incomplete?: string;
  available?: boolean;
  reason?: string;
}

export interface GuidanceReviewInfo {
  model: string;
  provider?: "gemini" | "bedrock";
  hasProviderCredentials: boolean;
  targetPath: string;
  targetExisted: boolean;
}

export interface GuidanceToolPayload {
  callRef: string;
  section: "input" | "output" | "error";
  content?: string;
  available: boolean;
  nextCursor?: string;
  hasMore: boolean;
  sourceVersion: string;
}

export interface GuidanceEvidenceReference {
  sessionId: string;
  entryId?: string;
  callRef?: string;
  section?: "input" | "output" | "error";
}

export interface GuidanceEdit {
  id: string;
  operation: GuidanceEditOperation;
  oldText?: string;
  anchor?: string;
  newText?: string;
  title: string;
  rationale: string;
  category: string;
  usefulness: string;
  evidence: GuidanceEvidenceReference[];
}

export interface GuidanceAssessment {
  intent: string;
  friction: string;
  outcome: string;
  uncertainty?: string;
}

export interface GuidanceReview {
  id: string;
  projectId: string;
  checkout: string;
  targetPath: string;
  targetExisted: boolean;
  /** Exact initial content used to validate model-proposed locations; private review state. */
  initialGuidance: string;
  selectedSessionIds: string[];
  sourceVersions: Record<string, string>;
  /** Absent records use the pre-multi-client OpenCode identity codec. */
  historyReferenceVersion?: 1;
  selectedSessionManifest?: Array<{
    id: string;
    sourceId: string;
    nativeSessionId: string;
    client: GuidanceSessionSummary["client"];
    title: string;
    directory?: string;
    decoderVersion: string;
    limitations?: string;
  }>;
  model: string;
  provider?: "gemini" | "bedrock";
  status: GuidanceReviewStatus;
  createdAt: string;
  updatedAt: string;
  progress: string;
  coverage?: string;
  limitations?: string;
  assessment?: GuidanceAssessment;
  edits: GuidanceEdit[];
  decisions: Record<string, "selected" | "rejected">;
  evidence: Record<string, { hash: string; excerpt: string }>;
  writeIntent?: { editIds: string[]; contentHash: string };
  error?: string;
  appliedAt?: string;
  tokenUsage?: { input?: number; output?: number; total?: number };
}

// --- extension points ---

export interface ProbeContext {
  /** Absolute path of the project being probed. */
  path: string;
  facts: ProjectFacts;
  /** Absolute scan root. */
  root: string;
  /** Whether this scan is allowed to hit the network. */
  fetch: boolean;
  /** Run a command in the project directory. Never throws; check `ok`. */
  run: (cmd: string, args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
  /** Directory names the walker prunes. Probes should honour it. */
  pruneDirs: Set<string>;
  /** Whether this probe run is in quick mode (skip heavy history traversal and disk walking). */
  quick?: boolean;
}

export interface Probe {
  name: string;
  /** Probes with a lower order run first and can be depended on by later ones. */
  order?: number;
  /** Skip this probe entirely when it returns false. */
  appliesTo?: (facts: ProjectFacts) => boolean;
  /** Returned partial is shallow-merged into the project's facts. */
  detect: (ctx: ProbeContext) => Promise<Partial<ProjectFacts> | void>;
}

export interface Rule {
  name: string;
  severity: FlagSeverity;
  label: string;
  /** Return false, or a detail string to attach to the flag. */
  when: (facts: ProjectFacts, annotation: Annotation) => boolean | string;
  /** Fire even when the project is snoozed, obsolete or archived. Use for data-loss risks. */
  alwaysApply?: boolean;
}

export type RuleMeta = Pick<Rule, "name" | "severity" | "label"> & { alwaysApply: boolean };

export interface Action {
  name: string;
  label: string;
  description: string;
  /** Only offer this action for projects it can actually handle. */
  appliesTo: (project: Project) => boolean;
  /**
   * Emit shell lines for one project. Nothing is ever executed by the tool;
   * the lines are collected into a reviewable script.
   */
  script: (project: Project, root: string) => string[];
}

export type ActionMeta = Pick<Action, "name" | "label" | "description">;

export const SEVERITY_RANK: Record<FlagSeverity, number> = {
  critical: 3,
  warn: 2,
  info: 1,
  good: 0,
};

// --- agent tools ---

export const AGENT_TOOL_IDS = ["codex", "opencode", "claude", "antigravity", "gemini"] as const;
export type AgentToolId = typeof AGENT_TOOL_IDS[number];
export type ToolCapabilityState = "ready" | "unsupported" | "missing" | "error";

export interface ToolInstallation {
  installed: boolean;
  executablePath?: string | null;
  appPath?: string | null;
  version?: string | null;
  candidatePaths: string[];
  probedAt: string;
}

export interface ToolCapabilityResult<T> {
  state: ToolCapabilityState;
  items: T[];
  reason?: string;
  diagnostics?: string[];
  truncated?: boolean;
}

export type GlobalResourceKind = "skill" | "subagent" | "instruction";
export type GlobalResourceOrigin = "user" | "shared" | "plugin" | "bundled";
export type GlobalResourceActivation = "enabled" | "disabled" | "unknown";

export interface GlobalResource {
  id: string;
  toolId: AgentToolId;
  kind: GlobalResourceKind;
  name: string;
  description?: string;
  path: string;
  canonicalId: string;
  origin: GlobalResourceOrigin;
  activation: GlobalResourceActivation;
  modelRestriction?: string;
  toolRestrictions?: string[];
  reasoningEffort?: string;
  sandboxMode?: string;
}

export interface ConfigurationReference {
  id: string;
  toolId: AgentToolId;
  label: string;
  path: string;
  canonicalPath: string;
  exists: boolean;
  sizeBytes?: number;
  lastModifiedAt?: string;
}

export interface McpServerDeclaration {
  id: string;
  toolId: AgentToolId;
  name: string;
  transport: "stdio" | "sse" | "http" | "unknown";
  state: "enabled" | "disabled" | "unknown";
  configRefId: string;
  sourcePath: string;
  duplicate?: boolean;
  conflict?: boolean;
}

export interface RecentSessionSummary {
  id: string;
  toolId: AgentToolId;
  title: string;
  clientMode?: string;
  lastActivityAt: string;
  projectAssociation?: { kind: "known_project" | "external_folder" | "projectless"; projectId?: string; path?: string; name?: string };
  transcriptAvailable: boolean;
}

export interface AgentToolSummary {
  id: AgentToolId;
  name: string;
  installation: ToolInstallation;
  capabilities: {
    skills: ToolCapabilityState;
    subagents: ToolCapabilityState;
    instructions: ToolCapabilityState;
    mcp: ToolCapabilityState;
    config: ToolCapabilityState;
    sessions: ToolCapabilityState;
  };
  warningCount: number;
}

export interface AgentToolDetails {
  summary: AgentToolSummary;
  configuredRoots: string[];
  lastRefreshedAt: string;
  skills: ToolCapabilityResult<GlobalResource>;
  subagents: ToolCapabilityResult<GlobalResource>;
  instructions: ToolCapabilityResult<GlobalResource>;
  mcpServers: ToolCapabilityResult<McpServerDeclaration>;
  configurations: ConfigurationReference[];
  recentSessions: ToolCapabilityResult<RecentSessionSummary>;
}

export interface AgentResourcePreview {
  id: string;
  name: string;
  content: string;
  isMarkdown: boolean;
  truncated: boolean;
  totalBytes: number;
}

export interface OpenConfigurationRequest {
  ref: string;
  action: "editor" | "reveal";
  ide?: string;
}

export interface OpenConfigurationResult {
  ok: boolean;
  message?: string;
}

export interface ReadResourceRequest {
  ref: string;
}

export interface AgentToolsListResult {
  tools: AgentToolSummary[];
}
