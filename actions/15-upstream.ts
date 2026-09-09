import type { Action, Project } from "../core/types.ts";

export const action: Action = {
  name: "set-upstream",
  label: "Set upstream & push",
  description: "Set remote tracking branch and push current branch to remote.",
  appliesTo: (project: Project) =>
    project.isGit === true && project.hasRemote === true && project.noUpstream === true,
  script: (project: Project, _root: string) => {
    const lines: string[] = [];
    const remote = project.remoteName ?? "origin";
    const branch = project.branch ?? "main";
    lines.push(`# ── ${project.relPath} ──────────`);
    lines.push(`cd "$ROOT/${project.relPath}"`);
    lines.push(`git push -u ${remote} "${branch}"`);
    lines.push(``);
    return lines;
  },
};
