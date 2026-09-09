import type { Probe } from "../core/types.ts";

export const probe: Probe = {
  name: "git-sync",
  order: 20,
  appliesTo: (facts) => facts.isGit === true,
  async detect({ path, facts, run }) {
    const out: Record<string, unknown> = {};

    // ahead / behind / noUpstream
    const revResult = await run("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    if (revResult.ok) {
      const parts = revResult.stdout.trim().split(/\s+/);
      if (parts.length === 2) {
        const ahead = Number(parts[0]);
        const behind = Number(parts[1]);
        if (Number.isFinite(ahead)) out.ahead = ahead;
        if (Number.isFinite(behind)) out.behind = behind;
        out.noUpstream = false;
      }
    } else {
      out.noUpstream = true;
    }

    // dirtyFiles / untrackedFiles
    const statusResult = await run("git", ["status", "--porcelain=v1", "--untracked-files=normal"]);
    if (statusResult.ok) {
      let dirty = 0;
      let untracked = 0;
      for (const line of statusResult.stdout.split("\n")) {
        if (!line) continue;
        if (line.startsWith("??")) {
          untracked++;
        } else {
          dirty++;
        }
      }
      out.dirtyFiles = dirty;
      out.untrackedFiles = untracked;
    }

    // stashes
    const stashResult = await run("git", ["stash", "list"]);
    if (stashResult.ok) {
      const lines = stashResult.stdout.split("\n").filter((l) => l.trim() !== "");
      out.stashes = lines.length;
    }

    // localOnlyBranches
    const forEachResult = await run("git", [
      "for-each-ref",
      "--format=%(refname:short)\t%(upstream)",
      "refs/heads",
    ]);
    if (forEachResult.ok) {
      const localOnly: string[] = [];
      for (const line of forEachResult.stdout.split("\n")) {
        if (!line) continue;
        const [branchName, upstream] = line.split("\t");
        if (branchName && (!upstream || upstream === "")) {
          localOnly.push(branchName);
          if (localOnly.length >= 20) break;
        }
      }
      out.localOnlyBranches = localOnly;
    }

    // lastFetchAt
    let lastFetchAt: string | null = null;
    const commonDirResult = await run("git", [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    if (commonDirResult.ok) {
      const commonDir = commonDirResult.stdout.trim();
      try {
        const { stat } = await import("node:fs/promises");
        const fetchHeadPath = `${commonDir}/FETCH_HEAD`;
        const stats = await stat(fetchHeadPath);
        lastFetchAt = stats.mtime.toISOString();
      } catch {
        lastFetchAt = null;
      }
    }
    out.lastFetchAt = lastFetchAt;

    return out;
  },
};
