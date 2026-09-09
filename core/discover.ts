import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { ProjectFacts, ProjectKind } from "./types.ts";
import type { Config } from "./config.ts";

/**
 * Files that mark a directory as a project in its own right.
 * Used to catch code that was never put under version control.
 */
const MANIFEST_FILES = new Set([
  "package.json",
  "project.json",
  "nx.json",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "setup.py",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "Package.swift",
  "pubspec.yaml",
  "mix.exs",
  "deno.json",
  "Makefile",
  "CMakeLists.txt",
  "docker-compose.yml",
  "docker-compose.yaml",
  "Dockerfile",
  "terraform.tf",
  "main.tf",
]);

const MANIFEST_EXTENSIONS = [".csproj", ".fsproj", ".sln", ".xcodeproj", ".xcworkspace"];

function isManifest(entryName: string): boolean {
  if (MANIFEST_FILES.has(entryName)) return true;
  return MANIFEST_EXTENSIONS.some((ext) => entryName.endsWith(ext));
}

interface Candidate {
  path: string;
  relPath: string;
  depth: number;
  hasGit: boolean;
  gitIsFile: boolean;
  manifests: string[];
}

/**
 * Resolves what a `.git` file (as opposed to directory) actually points at.
 * Linked worktrees and submodules both use a `.git` file, but they are very
 * different things for inventory purposes: a worktree is a second view of a repo
 * you already counted, a submodule belongs to its parent.
 */
async function classifyGitFile(projectPath: string): Promise<ProjectKind> {
  try {
    const content = await readFile(resolve(projectPath, ".git"), "utf8");
    const target = content.replace(/^gitdir:\s*/, "").trim();
    if (target.includes(`${sep}worktrees${sep}`)) return "worktree";
    if (target.includes(`${sep}modules${sep}`)) return "submodule";
  } catch {
    // Unreadable .git file — treat as a plain repo and let the probes fail gracefully.
  }
  return "repo";
}

/**
 * Identity is the relative path of the project within the scan root.
 * Guarantees 100% uniqueness across standalone repos, monorepo roots, and sub-projects.
 */
export function projectId(
  _remoteUrl: string | null | undefined,
  relPath: string,
  _parentRepoRelPath?: string | null,
): string {
  return relPath;
}

/**
 * Walks the root and returns every project it finds, git-tracked or not.
 *
 * Descends *into* repositories rather than stopping at them, because nested
 * repos are exactly the kind of thing that goes unnoticed — a checkout sitting
 * inside another checkout, invisible to the parent's git status.
 */
export async function discover(config: Config): Promise<ProjectFacts[]> {
  const prune = new Set(config.pruneDirs);
  const roots = config.roots && config.roots.length > 0 ? config.roots : [config.root];
  const allProjects: ProjectFacts[] = [];

  for (const rootDir of roots) {
    const candidates: Candidate[] = [];

    async function walk(dir: string, depth: number): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // Permission denied or a dangling symlink; nothing to inventory.
      }

      const manifests: string[] = [];
      let hasGit = false;
      let gitIsFile = false;
      const subdirs: string[] = [];

      for (const entry of entries) {
        if (entry.name === ".git") {
          hasGit = true;
          gitIsFile = entry.isFile();
          continue;
        }
        if (entry.isDirectory()) {
          if (!prune.has(entry.name)) subdirs.push(entry.name);
          else if (isManifest(entry.name)) manifests.push(entry.name);
          continue;
        }
        if (isManifest(entry.name)) manifests.push(entry.name);
      }
      // `.xcodeproj` is a directory, and `bin`/`obj` are pruned but a `.csproj`
      // never lives inside them, so the check above is enough.
      for (const name of subdirs) {
        if (isManifest(name)) manifests.push(name);
      }

      const relPath = relative(rootDir, dir) || ".";
      if (hasGit || manifests.length > 0) {
        candidates.push({ path: dir, relPath, depth, hasGit, gitIsFile, manifests });
      }

      if (depth >= config.maxDepth) return;
      await Promise.all(subdirs.map((name) => walk(resolve(dir, name), depth + 1)));
    }

    await walk(rootDir, 0);

    const ignored = (relPath: string) =>
      relPath === "." ||
      config.ignore.some((prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`));

    const visible = candidates
      .filter((candidate) => !ignored(candidate.relPath))
      .sort((a, b) => a.relPath.localeCompare(b.relPath));

    const gitPaths = visible.filter((candidate) => candidate.hasGit).map((c) => c.relPath);

    /** Nearest ancestor that is itself a git project. */
    const enclosingRepo = (relPath: string): string | null => {
      let best: string | null = null;
      for (const gitPath of gitPaths) {
        if (relPath === gitPath) continue;
        if (relPath.startsWith(`${gitPath}/`) && (best === null || gitPath.length > best.length)) {
          best = gitPath;
        }
      }
      return best;
    };

    const projectsInRoot: ProjectFacts[] = [];
    for (const candidate of visible) {
      const parentRepo = enclosingRepo(candidate.relPath);

      let isSubProject = false;
      if (!candidate.hasGit && parentRepo !== null) {
        // Check if this candidate is an Nx sub-project inside an Nx workspace
        const parentCandidate = visible.find((c) => c.relPath === parentRepo);
        const parentIsNx = parentCandidate?.manifests.includes("nx.json") ?? false;
        const isNxProjectFile = candidate.manifests.includes("project.json");
        const isSubFolderApp =
          parentIsNx &&
          (candidate.relPath.startsWith(`${parentRepo}/apps/`) ||
            candidate.relPath.startsWith(`${parentRepo}/packages/`) ||
            candidate.relPath.startsWith(`${parentRepo}/services/`) ||
            candidate.relPath.startsWith(`${parentRepo}/libs/`) ||
            candidate.relPath.includes("/apps/") ||
            candidate.relPath.includes("/packages/") ||
            candidate.relPath.includes("/services/") ||
            candidate.relPath.includes("/libs/")) &&
          candidate.manifests.length > 0;

        if (isNxProjectFile || isSubFolderApp) {
          isSubProject = true;
        } else {
          continue;
        }
      }

      // Nor is a sub-package of an already discovered sub-project a project of its own.
      if (
        !candidate.hasGit &&
        projectsInRoot.some(
          (p) => p.relPath !== parentRepo && candidate.relPath.startsWith(`${p.relPath}/`),
        )
      ) {
        continue;
      }

      const kind: ProjectKind = candidate.hasGit
        ? candidate.gitIsFile
          ? await classifyGitFile(candidate.path)
          : "repo"
        : parentRepo !== null
          ? "repo"
          : "orphan";

      const segments = candidate.relPath.split("/");
      projectsInRoot.push({
        // Replaced by a remote-derived id once git-basics has run.
        id: projectId(null, candidate.relPath, parentRepo),
        kind,
        path: candidate.path,
        relPath: candidate.relPath,
        name: segments.at(-1)!,
        group: segments.length > 1 ? segments[0]! : "(root)",
        nestedIn: parentRepo,
        depth: candidate.depth,
        rootDir,
        isGit: candidate.hasGit || isSubProject,
        isSubProject: isSubProject ? true : undefined,
        projectType: isSubProject ? "sub-project" : undefined,
        manifests: candidate.manifests,
      });
    }

    allProjects.push(...projectsInRoot);
  }

  return allProjects;
}

/**
 * Discovers subprojects (like Nx apps and libraries) within a specific parent repository.
 */
export async function discoverSubprojects(
  parentPath: string,
  parentRelPath: string,
  config: Config,
  parentManifests: string[] = [],
): Promise<ProjectFacts[]> {
  const prune = new Set(config.pruneDirs);
  const candidates: Candidate[] = [];

  const parentIsNx =
    parentManifests.includes("nx.json") ||
    (await stat(resolve(parentPath, "nx.json"))
      .then((s) => s.isFile())
      .catch(() => false));

  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const manifests: string[] = [];
    let hasGit = false;
    let gitIsFile = false;
    const subdirs: string[] = [];

    for (const entry of entries) {
      if (entry.name === ".git") {
        hasGit = true;
        gitIsFile = entry.isFile();
        continue;
      }
      if (entry.isDirectory()) {
        if (!prune.has(entry.name)) subdirs.push(entry.name);
        else if (isManifest(entry.name)) manifests.push(entry.name);
        continue;
      }
      if (isManifest(entry.name)) manifests.push(entry.name);
    }
    for (const name of subdirs) {
      if (isManifest(name)) manifests.push(name);
    }

    if (dir !== parentPath && (hasGit || manifests.length > 0)) {
      const relPath = relative(config.root, dir) || ".";
      candidates.push({ path: dir, relPath, depth, hasGit, gitIsFile, manifests });
    }

    if (depth >= config.maxDepth) return;
    await Promise.all(subdirs.map((name) => walk(resolve(dir, name), depth + 1)));
  }

  const parentDepth = parentRelPath.split("/").length;
  await walk(parentPath, parentDepth);

  const ignored = (relPath: string) =>
    config.ignore.some((prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`));

  const visible = candidates
    .filter((candidate) => !ignored(candidate.relPath))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  const projects: ProjectFacts[] = [];
  for (const candidate of visible) {
    if (candidate.hasGit) continue;

    const isNxProjectFile = candidate.manifests.includes("project.json");
    const isSubFolderApp =
      parentIsNx &&
      (candidate.relPath.startsWith(`${parentRelPath}/apps/`) ||
        candidate.relPath.startsWith(`${parentRelPath}/packages/`) ||
        candidate.relPath.startsWith(`${parentRelPath}/services/`) ||
        candidate.relPath.startsWith(`${parentRelPath}/libs/`) ||
        candidate.relPath.includes("/apps/") ||
        candidate.relPath.includes("/packages/") ||
        candidate.relPath.includes("/services/") ||
        candidate.relPath.includes("/libs/")) &&
      candidate.manifests.length > 0;

    if (!isNxProjectFile && !isSubFolderApp) continue;

    if (projects.some((p) => candidate.relPath.startsWith(`${p.relPath}/`))) {
      continue;
    }

    const segments = candidate.relPath.split("/");
    projects.push({
      id: projectId(null, candidate.relPath, parentRelPath),
      kind: "repo",
      path: candidate.path,
      relPath: candidate.relPath,
      name: segments.at(-1)!,
      group: segments.length > 1 ? segments[0]! : "(root)",
      nestedIn: parentRelPath,
      depth: candidate.depth,
      isGit: true,
      isSubProject: true,
      projectType: "sub-project",
      manifests: candidate.manifests,
    });
  }

  return projects;
}

/** Directory size in bytes, split into source and reclaimable build output. */
export async function measureFootprint(
  dir: string,
  prune: Set<string>,
  disposable: Set<string>,
): Promise<{ sourceBytes: number; disposableBytes: number; sourceFiles: number; newestMtimeMs: number }> {
  let sourceBytes = 0;
  let disposableBytes = 0;
  let sourceFiles = 0;
  let newestMtimeMs = 0;

  async function sizeOf(target: string): Promise<number> {
    let total = 0;
    let entries;
    try {
      entries = await readdir(target, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const entry of entries) {
      const full = resolve(target, entry.name);
      if (entry.isDirectory()) total += await sizeOf(full);
      else if (entry.isFile()) {
        try {
          total += (await stat(full)).size;
        } catch {
          // Vanished mid-scan.
        }
      }
    }
    return total;
  }

  async function walk(target: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(target, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(target, entry.name);
      if (entry.isDirectory()) {
        if (disposable.has(entry.name)) {
          disposableBytes += await sizeOf(full);
        } else if (!prune.has(entry.name)) {
          await walk(full);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stats = await stat(full);
        sourceBytes += stats.size;
        sourceFiles += 1;
        if (stats.mtimeMs > newestMtimeMs) {
          newestMtimeMs = stats.mtimeMs;
        }
      } catch {
        // Vanished mid-scan.
      }
    }
  }

  await walk(dir);
  return { sourceBytes, disposableBytes, sourceFiles, newestMtimeMs };
}
