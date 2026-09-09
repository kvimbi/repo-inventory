import type { Probe } from "../core/types.ts";

export const probe: Probe = {
  name: "git-fetch",
  order: 15,
  appliesTo: (facts) => facts.isGit === true && facts.hasRemote === true,
  async detect({ facts, run, fetch }) {
    if (!fetch) return;
    if (!facts.remoteName) return;

    const result = await run("git", ["fetch", "--prune", "--quiet", facts.remoteName]);
    if (!result.ok) {
      const firstLine = result.stderr.split("\n")[0] ?? result.stderr;
      return {
        extra: {
          ...facts.extra,
          fetchError: firstLine,
        },
      };
    }
  },
};
