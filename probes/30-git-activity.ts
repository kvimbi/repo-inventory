import type { Probe } from "../core/types.ts";

export const probe: Probe = {
  name: "git-activity",
  order: 30,
  appliesTo: (facts) => facts.isGit === true,
  async detect({ run, facts, quick }) {
    const out: Record<string, unknown> = {};

    // lastCommitAt, lastCommitSubject, lastCommitAgeDays
    const logResult = await run("git", ["log", "-1", "--format=%cI\t%s"]);
    if (logResult.ok) {
      const tabIndex = logResult.stdout.indexOf("\t");
      if (tabIndex > 0) {
        const isoDate = logResult.stdout.slice(0, tabIndex);
        const subject = logResult.stdout.slice(tabIndex + 1).trim();
        const date = new Date(isoDate);
        if (!Number.isNaN(date.getTime())) {
          out.lastCommitAt = isoDate;
          out.lastCommitSubject = subject;
          const ageDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
          out.lastCommitAgeDays = ageDays;
        } else {
          out.lastCommitAt = null;
          out.lastCommitSubject = null;
          out.lastCommitAgeDays = null;
        }
      } else {
        out.lastCommitAt = null;
        out.lastCommitSubject = null;
        out.lastCommitAgeDays = null;
      }
    } else {
      out.lastCommitAt = null;
      out.lastCommitSubject = null;
      out.lastCommitAgeDays = null;
    }

    // In quick mode, if lastCommitAt is unchanged, reuse historical commit counts and authors
    if (quick && out.lastCommitAt === facts.lastCommitAt) {
      if (facts.commits30d !== undefined) out.commits30d = facts.commits30d;
      if (facts.commits90d !== undefined) out.commits90d = facts.commits90d;
      if (facts.commitCount !== undefined) out.commitCount = facts.commitCount;
      if (facts.authors !== undefined) out.authors = facts.authors;
      return out;
    }

    // commit counts
    const counts: Record<string, number> = {};
    const since30 = await run("git", ["rev-list", "--count", "--all", "--since=30.days"]);
    if (since30.ok) {
      const n = Number(since30.stdout.trim());
      if (Number.isFinite(n)) counts.commits30d = n;
    }
    const since90 = await run("git", ["rev-list", "--count", "--all", "--since=90.days"]);
    if (since90.ok) {
      const n = Number(since90.stdout.trim());
      if (Number.isFinite(n)) counts.commits90d = n;
    }
    const allTime = await run("git", ["rev-list", "--count", "--all"]);
    if (allTime.ok) {
      const n = Number(allTime.stdout.trim());
      if (Number.isFinite(n)) counts.commitCount = n;
    }
    Object.assign(out, counts);

    // authors
    const authorsResult = await run("git", ["log", "--all", "--format=%aN", "-n", "400"]);
    if (authorsResult.ok) {
      const seen = new Set<string>();
      const authors: string[] = [];
      for (const name of authorsResult.stdout.split("\n")) {
        if (!name || seen.has(name)) continue;
        seen.add(name);
        authors.push(name);
        if (authors.length >= 5) break;
      }
      out.authors = authors;
    }

    return out;
  },
};
