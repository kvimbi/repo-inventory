import type { Rule } from "../core/types.ts";

const SCRATCH = ["tmp", "test", "scratch", "sandbox", "playground"];
const inScratch = (relPath: string) => SCRATCH.includes(relPath.split("/")[0] ?? "");

export const rules: Rule[] = [
  // 1. UNPUSHED_WORK
  {
    name: "UNPUSHED_WORK",
    severity: "critical",
    label: "Unpushed commits",
    alwaysApply: true,
    when: (facts) => {
      if (facts.isGit !== true || facts.hasRemote !== true) return false;
      if ((facts.ahead ?? 0) > 0) {
        return `${facts.ahead} commit(s) ahead of ${facts.remoteName ?? "remote"}`;
      }
      return false;
    },
  },

  // 2. LOCAL_ONLY
  {
    name: "LOCAL_ONLY",
    severity: "critical",
    label: "No remote — exists only on this machine",
    alwaysApply: true,
    when: (facts) => {
      if (facts.isGit !== true || facts.hasRemote !== false) return false;
      if (facts.kind !== "repo") return false;
      return `${(facts as { commitCount?: number }).commitCount ?? 0} commits, no remote configured`;
    },
  },

  // 3. NOT_VERSIONED
  {
    name: "NOT_VERSIONED",
    severity: "critical",
    label: "Code with no git repository",
    alwaysApply: true,
    when: (facts) => {
      if (facts.kind !== "orphan") return false;
      const files = (facts.sourceFiles ?? 0);
      const manifests = (facts.manifests ?? []).join(", ") || "no manifest";
      return `${files} source files, ${manifests}`;
    },
  },

  // 4. LOCAL_ONLY_BRANCHES
  {
    name: "LOCAL_ONLY_BRANCHES",
    severity: "warn",
    label: "Branches that exist nowhere else",
    alwaysApply: true,
    when: (facts) => {
      if (facts.hasRemote !== true) return false;
      const branches = facts.localOnlyBranches ?? [];
      if (branches.length === 0) return false;
      if (branches.length <= 5) return branches.join(", ");
      const first5 = branches.slice(0, 5).join(", ");
      return `${first5} +${branches.length - 5} more`;
    },
  },

  // 5. UNCOMMITTED
  {
    name: "UNCOMMITTED",
    severity: "warn",
    label: "Uncommitted changes",
    when: (facts) => {
      const dirty = facts.dirtyFiles ?? 0;
      if (dirty === 0) return false;
      let detail = `${dirty} modified file(s)`;
      const untracked = facts.untrackedFiles ?? 0;
      if (untracked > 0) {
        detail += `, ${untracked} untracked`;
      }
      return detail;
    },
  },

  // 6. BEHIND_REMOTE
  {
    name: "BEHIND_REMOTE",
    severity: "warn",
    label: "Behind remote",
    when: (facts) => {
      const behind = facts.behind ?? 0;
      const ahead = facts.ahead ?? 0;
      if (behind > 0 && ahead === 0) {
        return `${behind} commit(s) behind`;
      }
      return false;
    },
  },

  // 7. DIVERGED
  {
    name: "DIVERGED",
    severity: "warn",
    label: "Diverged from remote",
    when: (facts) => {
      const ahead = facts.ahead ?? 0;
      const behind = facts.behind ?? 0;
      if (ahead > 0 && behind > 0) {
        return `${ahead} ahead, ${behind} behind`;
      }
      return false;
    },
  },

  // 8. SCRATCH_BUT_ACTIVE
  {
    name: "SCRATCH_BUT_ACTIVE",
    severity: "warn",
    label: "Active project living in a scratch folder",
    when: (facts) => {
      if (!inScratch(facts.relPath)) return false;
      const commits90d = (facts as { commits90d?: number }).commits90d ?? 0;
      if (commits90d < 5) return false;
      return `${commits90d} commits in 90 days, still under ${facts.group}/`;
    },
  },


  // 10. NO_UPSTREAM
  {
    name: "NO_UPSTREAM",
    severity: "info",
    label: "Current branch has no upstream",
    when: (facts) => {
      if (facts.noUpstream !== true) return false;
      if (facts.hasRemote !== true) return false;
      return `branch ${facts.branch ?? "(detached)"} tracks nothing`;
    },
  },

  // 11. STALE_REFS
  {
    name: "STALE_REFS",
    severity: "info",
    label: "Remote state is stale",
    when: (facts) => {
      if (facts.hasRemote !== true) return false;
      const lastFetch = facts.lastFetchAt;
      if (lastFetch === null || lastFetch === undefined) {
        return "never fetched";
      }
      const daysAgo = Math.floor((Date.now() - new Date(lastFetch).getTime()) / 86_400_000);
      if (daysAgo >= 30) {
        return `last fetched ${daysAgo} days ago — ahead/behind may be wrong`;
      }
      return false;
    },
  },

  // 12. STALE
  {
    name: "STALE",
    severity: "info",
    label: "No commits in 6 months",
    when: (facts) => {
      const age = facts.lastCommitAgeDays ?? -1;
      if (age >= 180 && age < 365) {
        return `last commit ${age} days ago`;
      }
      return false;
    },
  },

  // 13. ABANDONED
  {
    name: "ABANDONED",
    severity: "info",
    label: "No commits in over a year",
    when: (facts) => {
      const age = facts.lastCommitAgeDays ?? -1;
      if (age >= 365) {
        return `last commit ${age} days ago`;
      }
      return false;
    },
  },

  // 14. UNCOMMITTED_AND_ABANDONED
  {
    name: "UNCOMMITTED_AND_ABANDONED",
    severity: "critical",
    label: "Uncommitted work in an abandoned project",
    alwaysApply: true,
    when: (facts) => {
      const dirty = facts.dirtyFiles ?? 0;
      const age = facts.lastCommitAgeDays ?? 0;
      if (dirty > 0 && age >= 365) {
        return `${dirty} modified file(s) untouched for ${age} days`;
      }
      return false;
    },
  },

  // 15. NO_COMMITS
  {
    name: "NO_COMMITS",
    severity: "info",
    label: "Repository with no commits",
    when: (facts) => {
      if (facts.isGit !== true) return false;
      if (facts.lastCommitAt === null) {
        return "git initialised but nothing committed";
      }
      return false;
    },
  },

  // 16. RECLAIMABLE_SPACE
  {
    name: "RECLAIMABLE_SPACE",
    severity: "info",
    label: "Large build output",
    when: (facts) => {
      const disposable = facts.disposableBytes ?? 0;
      if (disposable > 500 * 1024 * 1024) {
        const gb = (disposable / 1024 / 1024 / 1024).toFixed(1);
        return `${gb} GB in build and dependency folders`;
      }
      return false;
    },
  },

  // 17. NO_README
  {
    name: "NO_README",
    severity: "info",
    label: "No README",
    when: (facts) => {
      if (facts.hasReadme !== false) return false;
      const commits = (facts as { commitCount?: number }).commitCount ?? 0;
      if (commits <= 10) return false;
      return true;
    },
  },

  // 18. DETACHED_HEAD
  {
    name: "DETACHED_HEAD",
    severity: "warn",
    label: "Detached HEAD",
    when: (facts) => {
      if (facts.detached === true) {
        return "HEAD is not on a branch";
      }
      return false;
    },
  },

  // 19. DIRTY_DUPLICATE
  {
    name: "DIRTY_DUPLICATE",
    severity: "critical",
    label: "Duplicate with uncommitted changes",
    alwaysApply: true,
    when: (facts) => {
      const dups = facts.duplicateOf ?? [];
      if (dups.length === 0) return false;
      if (!facts.isDuplicateCopy) return false;
      const dirty = facts.dirtyFiles ?? 0;
      const ahead = facts.ahead ?? 0;
      const untracked = facts.untrackedFiles ?? 0;
      if (dirty === 0 && ahead === 0 && untracked === 0) return false;
      const parts: string[] = [];
      if (dirty > 0) parts.push(`${dirty} modified`);
      if (untracked > 0) parts.push(`${untracked} untracked`);
      if (ahead > 0) parts.push(`${ahead} unpushed`);
      return `${parts.join(", ")} file(s) in duplicate copy`;
    },
  },

  // 20. DUPLICATE_REPO
  {
    name: "DUPLICATE_REPO",
    severity: "warn",
    label: "Duplicate repository",
    when: (facts) => {
      const dups = facts.duplicateOf ?? [];
      if (dups.length === 0) return false;
      const role = facts.isDuplicateCopy ? "Copy of" : "Primary of";
      if (dups.length <= 2) {
        return `${role} ${dups.join(", ")}`;
      }
      return `${role} ${dups[0]} +${dups.length - 1} more`;
    },
  },

  // 21. HEALTHY
  {
    name: "HEALTHY",
    severity: "good",
    label: "Healthy",
    when: (facts) => {
      if (facts.isGit !== true) return false;
      if (facts.hasRemote !== true) return false;
      if ((facts.ahead ?? 0) !== 0) return false;
      if ((facts.behind ?? 0) !== 0) return false;
      if ((facts.dirtyFiles ?? 0) !== 0) return false;
      if ((facts.localOnlyBranches ?? []).length !== 0) return false;
      if (facts.isDuplicateCopy === true) return false;
      if ((facts.lastCommitAgeDays ?? 9999) >= 180) return false;
      return true;
    },
  },
];
