import type { Action, Project } from "../core/types.ts";

const SCRATCH_DIRS = ["tmp", "test", "scratch", "sandbox", "playground"];

export const action: Action = {
  name: "graduate",
  label: "Move out of a scratch folder",
  description: "Relocate an active project from tmp/ into a permanent home.",
  appliesTo: (project: Project) => {
    const first = project.relPath.split("/")[0];
    return SCRATCH_DIRS.includes(first ?? "");
  },
  script: (project: Project, _root: string) => {
    const lines: string[] = [];
    const commits90d = (project as { commits90d?: number }).commits90d ?? 0;
    const lastAge = project.lastCommitAgeDays ?? 0;
    const ageStr = lastAge === 0 ? "today" : `${lastAge}d`;
    lines.push(`# ── ${project.relPath} ──────────`);
    lines.push(`# ${commits90d} commits in 90d, last commit ${ageStr} ago — this is not scratch work`);
    lines.push(`DEST="$ROOT/projects/${project.name}"   # EDIT: pick the permanent home`);
    lines.push(`if [ -e "$DEST" ]; then echo "skip ${project.relPath}: $DEST exists"; else`);
    lines.push(`  mkdir -p "$(dirname "$DEST")"`);
    lines.push(`  mv "$ROOT/${project.relPath}" "$DEST"`);
    lines.push(`  echo "moved ${project.relPath} -> $DEST"`);
    lines.push(`fi`);
    if (project.hasRemote === false) {
      lines.push(`# WARNING: no remote — publish this before moving it, or a mistake loses everything`);
    }
    if (project.nestedIn !== null && project.nestedIn !== undefined) {
      lines.push(`# WARNING: nested inside ${project.nestedIn}; check the parent repo's .gitignore after moving`);
    }
    lines.push("");
    return lines;
  },
};
