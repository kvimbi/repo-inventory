import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

/**
 * Resolves active working/data directory, prioritizing REPO_INVENTORY_BASE_DIR,
 * then standard desktop app user data directory if initialized, falling back to repository root.
 */
export function resolveBaseDir(fallbackDir: string): string {
  if (process.env.REPO_INVENTORY_BASE_DIR) {
    return process.env.REPO_INVENTORY_BASE_DIR;
  }

  const home = homedir();
  let candidate = "";
  if (process.platform === "darwin") {
    candidate = resolve(home, "Library/Application Support/repo-inventory");
  } else if (process.platform === "win32") {
    candidate = process.env.APPDATA
      ? resolve(process.env.APPDATA, "repo-inventory")
      : resolve(home, "AppData/Roaming/repo-inventory");
  } else {
    candidate = process.env.XDG_CONFIG_HOME
      ? resolve(process.env.XDG_CONFIG_HOME, "repo-inventory")
      : resolve(home, ".config/repo-inventory");
  }

  if (
    existsSync(resolve(candidate, "inventory.config.json")) ||
    existsSync(resolve(candidate, "data"))
  ) {
    return candidate;
  }

  return fallbackDir;
}

export interface Config {
  /** Absolute path of the folder holding all your repositories. */
  root: string;
  /** One or more root directories to scan. Defaults to [root] if not specified. */
  roots?: string[];
  /** How deep to look for projects below the root. */
  maxDepth: number;
  /** Directory names never descended into. */
  pruneDirs: string[];
  /** relPath prefixes to ignore entirely. */
  ignore: string[];
  /** Days without a commit before a project counts as stale. */
  staleDays: number;
  /** Days without a commit before a project counts as abandoned. */
  abandonedDays: number;
  /** Path segments that mark a scratch area projects are supposed to graduate out of. */
  scratchDirs: string[];
  port: number;
  /** Optional custom SSH host alias for git remotes (e.g. `github-kvimbi`). */
  sshHost?: string;
  /** Gemini API key for agent chat and assistance features. */
  geminiApiKey?: string;
  /** Amazon Bedrock API key (bearer token) for agent chat and assistance features. */
  bedrockApiKey?: string;
  /** Amazon Bedrock region (e.g. "us-east-1"). */
  bedrockRegion?: string;
  /** Default AI provider across features. */
  aiProvider?: "gemini" | "bedrock";
  /** AI provider used for chat assistant. */
  chatProvider?: "gemini" | "bedrock";
  /** Model used for chat assistant. */
  chatModel?: string;
  /** AI provider used for guidance reviews. */
  guidanceReviewProvider?: "gemini" | "bedrock";
  /** Model used only for guidance reviews; it intentionally does not share chat defaults. */
  guidanceReviewModel?: string;
  /** Explicit local OpenCode database source. No database discovery is performed. */
  openCodeDatabasePath?: string;
  /** Explicit Claude Code configuration root. Empty input restores the environment/default root. */
  claudeConfigDir?: string;
  /** Explicit Claude Desktop Code metadata root. Empty input restores the platform default. */
  claudeDesktopSessionsPath?: string;
  /** Explicit Claude Cowork metadata root. Empty input restores the platform default. */
  claudeCoworkSessionsPath?: string;
  /** Explicit Codex home directory. Empty input restores $CODEX_HOME or ~/.codex. */
  codexHome?: string;
  /** Local history adapters allowed to expose evidence. */
  guidanceHistorySources?: Array<"opencode" | "claude" | "cowork" | "codex">;
  /** Regex patterns matching allowed commands for the root-level terminal search tool. */
  allowedRootBashPatterns?: string[];
}

export const DEFAULT_ALLOWED_ROOT_BASH_PATTERNS = [
  "(find|fd)",
  "(grep|rg|ag)",
  "(ls|dir)",
  "tree",
  "(cat|head|tail|wc|sort|uniq|awk|sed|cut|tr|xargs)",
  "(file|stat)",
  "git\\s+(status|log|branch|rev-parse|show|diff|tag)",
];

const DEFAULTS: Config = {
  root: resolve(homedir(), "code"),
  maxDepth: 5,
  pruneDirs: [
    "node_modules",
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".nx",
    "target",
    "bin",
    "obj",
    "Pods",
    "Carthage",
    "DerivedData",
    ".gradle",
    ".idea",
    ".vs",
    ".vscode",
    "vendor",
    "bower_components",
    ".terraform",
    ".cache",
    "coverage",
    ".DS_Store",
  ],
  ignore: [],
  staleDays: 180,
  abandonedDays: 365,
  scratchDirs: ["tmp", "test", "scratch", "sandbox", "playground"],
  port: 4747,
  allowedRootBashPatterns: DEFAULT_ALLOWED_ROOT_BASH_PATTERNS,
};

/**
 * Doc-like files the dashboard offers to preview/render for a project.
 * Order is the order they appear in the UI list. Checked for existence at
 * request time — nothing here is scanned or cached.
 */
export const RENDERABLE_DOC_FILES = [
  "README.md",
  "readme.md",
  "README.rst",
  "README.txt",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  ".github/copilot-instructions.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
];

/** Directories that are pure build or dependency output, safe to report as reclaimable. */
export const DISPOSABLE_DIRS = new Set([
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".nx",
  "target",
  "obj",
  "Pods",
  "DerivedData",
  ".gradle",
  ".cache",
  "coverage",
]);

/** Loads `inventory.config.json` next to the tool, falling back to defaults. */
export async function loadConfig(dir: string): Promise<Config> {
  let overrides: Partial<Config> = {};
  try {
    overrides = JSON.parse(await readFile(resolve(dir, "inventory.config.json"), "utf8"));
  } catch {
    // No config file is the normal case.
  }
  const merged: Config = { ...DEFAULTS, ...overrides };
  merged.allowedRootBashPatterns =
    Array.isArray(overrides.allowedRootBashPatterns) && overrides.allowedRootBashPatterns.length > 0
      ? overrides.allowedRootBashPatterns
      : DEFAULT_ALLOWED_ROOT_BASH_PATTERNS;
  merged.root = isAbsolute(merged.root)
    ? merged.root
    : resolve(merged.root.replace(/^~/, homedir()));

  if (merged.roots && Array.isArray(merged.roots) && merged.roots.length > 0) {
    merged.roots = merged.roots.map((r) =>
      isAbsolute(r) ? r : resolve(r.replace(/^~/, homedir())),
    );
    merged.root = merged.roots[0] ?? merged.root;
  } else {
    merged.roots = [merged.root];
  }

  if (merged.geminiApiKey && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = merged.geminiApiKey;
  }
  if (merged.bedrockApiKey && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = merged.bedrockApiKey;
  }
  if (merged.bedrockRegion && !process.env.AWS_REGION) {
    process.env.AWS_REGION = merged.bedrockRegion;
  }

  return merged;
}

/** Saves updates to `inventory.config.json` atomically and returns the fresh configuration. */
export async function saveConfig(dir: string, updates: Partial<Config>): Promise<Config> {
  let existing: Record<string, unknown> = {};
  const configPath = resolve(dir, "inventory.config.json");
  try {
    existing = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    existing = {};
  }

  const updated = { ...existing, ...updates };

  // Write atomically
  const tempPath = resolve(dir, "inventory.config.json.tmp");
  await writeFile(tempPath, JSON.stringify(updated, null, 2));
  await rename(tempPath, configPath);

  if (updates.geminiApiKey !== undefined) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = updates.geminiApiKey;
  }
  if (updates.bedrockApiKey !== undefined) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = updates.bedrockApiKey;
  }
  if (updates.bedrockRegion !== undefined) {
    process.env.AWS_REGION = updates.bedrockRegion;
  }

  return loadConfig(dir);
}
