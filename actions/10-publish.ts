import type { Action, Project } from "../core/types.ts";

export const action: Action = {
  name: "publish",
  label: "Publish to a remote",
  description: "Create a GitHub repo and push, for projects that exist only on this machine.",
  appliesTo: (project: Project) =>
    project.isGit === true && project.hasRemote === false && project.kind === "repo",
  script: (project: Project, _root: string) => {
    const lines: string[] = [];
    const name = project.name;
    const branch = project.branch ?? "main";
    const commits = (project as { commitCount?: number }).commitCount ?? 0;
    lines.push(`# ── ${project.relPath} ──────────`);
    lines.push(`cd "$ROOT/${project.relPath}"`);
    lines.push(`# ${commits} commits on branch ${branch}, currently no remote`);
    lines.push(`gh repo create "${name}" --private --source=. --push`);
    lines.push("");
    return lines;
  },
};
