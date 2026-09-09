import type { Action, Project } from "../core/types.ts";

export const action: Action = {
  name: "fetch",
  label: "Fetch remote state",
  description: "Run git fetch --prune --quiet to update remote tracking refs.",
  appliesTo: (project: Project) =>
    project.isGit === true &&
    project.hasRemote === true &&
    project.flags.some((f) => f.rule === "STALE_REFS"),
  script: (project: Project, _root: string) => {
    const lines: string[] = [];
    const remote = project.remoteName ?? "origin";
    lines.push(`# ── ${project.relPath} ──────────`);
    lines.push(`cd "$ROOT/${project.relPath}"`);
    lines.push(`git fetch --prune --quiet ${remote}`);
    lines.push("");
    return lines;
  },
};
