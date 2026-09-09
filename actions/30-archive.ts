import type { Action, Project } from "../core/types.ts";

export const action: Action = {
  name: "archive",
  label: "Archive",
  description: "Compress a finished project into archive/ and remove the working copy.",
  appliesTo: (project: Project) =>
    project.annotation.status === "obsolete" || project.annotation.status === "archived",
  script: (project: Project, _root: string) => {
    const lines: string[] = [];
    const ahead = project.ahead ?? 0;
    const dirty = project.dirtyFiles ?? 0;
    const noRemote = project.hasRemote === false;
    const note = project.annotation.note?.replace(/\n/g, " ") ?? "";
    lines.push(`# ── ${project.relPath} ──────────`);
    if (note) {
      lines.push(`# note: ${note}`);
    }
    if (ahead > 0 || dirty > 0 || noRemote) {
      lines.push(`# SKIPPED ${project.relPath}: has unpushed or uncommitted work, or no remote.`);
      lines.push(`# Run the "publish" action first. Archiving this would destroy the only copy.`);
    } else {
      const flatname = project.relPath.replace(/\//g, "-");
      lines.push(`mkdir -p "$ROOT/archive"`);
      lines.push(`tar -czf "$ROOT/archive/${flatname}-$(date +%Y%m%d).tar.gz" -C "$ROOT" "${project.relPath}"`);
      lines.push(`# removes the working copy; the tarball above and the git remote are the remaining copies`);
      lines.push(`rm -rf "$ROOT/${project.relPath}"`);
    }
    lines.push("");
    return lines;
  },
};
