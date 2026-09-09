import type { Probe } from "../core/types.ts";

/** Extracts the host from any of the URL shapes git accepts. */
function remoteHost(url: string): string | null {
  const match =
    /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(url) ?? /^(?:[^@]+@)([^:/]+)[:/]/.exec(url);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Establishes git identity: branch, remote, and remotes list.
 */
export const probe: Probe = {
  name: "git-basics",
  order: 0,
  appliesTo: (facts) => facts.isGit === true,

  async detect({ path, facts, run, quick }) {
    if (quick && facts.remoteName !== undefined) {
      const [head, headShaRes, branchesRes] = await Promise.all([
        run("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
        run("git", ["rev-parse", "HEAD"]),
        run("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"]),
      ]);

      const branch = head.ok ? head.stdout.trim() : null;
      const headCommitSha = headShaRes.ok ? headShaRes.stdout.trim() || null : null;
      return {
        branch: branch === "HEAD" ? null : branch,
        detached: branch === "HEAD",
        headCommitSha,
        rootCommitSha: facts.rootCommitSha ?? null,
        branchCount: branchesRes.ok
          ? branchesRes.stdout.split("\n").filter((line) => line.trim()).length
          : facts.branchCount ?? 0,
      };
    }

    const [head, headShaRes, rootShaRes, remotesRes, branchesRes] = await Promise.all([
      run("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
      run("git", ["rev-parse", "HEAD"]),
      run("git", ["rev-list", "--max-parents=0", "HEAD"]),
      run("git", ["remote"]),
      run("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"]),
    ]);

    const branch = head.ok ? head.stdout.trim() : null;
    const headCommitSha = headShaRes.ok ? headShaRes.stdout.trim() || null : null;
    const rootCommitSha = rootShaRes.ok
      ? rootShaRes.stdout.trim().split("\n").filter(Boolean)[0] || null
      : null;
    const remotes = remotesRes.ok ? remotesRes.stdout.trim().split("\n").filter(Boolean) : [];
    // `origin` is conventional but not guaranteed; fall back to whatever exists.
    const remoteName = remotes.includes("origin") ? "origin" : (remotes[0] ?? null);

    let remoteUrl: string | null = null;
    if (remoteName) {
      const urlRes = await run("git", ["remote", "get-url", remoteName]);
      remoteUrl = urlRes.ok ? urlRes.stdout.trim() || null : null;
    }

    let defaultBranch: string | null = null;
    if (remoteName) {
      const symRes = await run("git", ["symbolic-ref", `refs/remotes/${remoteName}/HEAD`]);
      if (symRes.ok) defaultBranch = symRes.stdout.trim().split("/").pop() ?? null;
    }

    return {
      branch: branch === "HEAD" ? null : branch,
      detached: branch === "HEAD",
      headCommitSha,
      rootCommitSha,
      branchCount: branchesRes.ok
        ? branchesRes.stdout.split("\n").filter((line) => line.trim()).length
        : 0,
      hasRemote: remoteName !== null,
      remoteName,
      remoteUrl,
      remoteHost: remoteUrl ? remoteHost(remoteUrl) : null,
      defaultBranch,
      extra: { ...facts.extra, gitPath: path, remotes },
    };
  },
};
