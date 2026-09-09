import type { Action, Project } from "../core/types.ts";

const DISPOSABLE = [
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".nx",
  "target",
  "obj",
  "Pods",
  "DerivedData",
  ".cache",
  "coverage",
];

export const action: Action = {
  name: "reclaim-space",
  label: "Delete build output",
  description: "Remove node_modules, .venv, dist and friends. All of it is regenerable.",
  appliesTo: (project: Project) => (project.disposableBytes ?? 0) > 50 * 1024 * 1024,
  script: (project: Project, _root: string) => {
    const lines: string[] = [];
    const gb = ((project.disposableBytes ?? 0) / 1024 / 1024 / 1024).toFixed(1);
    lines.push(`# ── ${project.relPath} ──────────`);
    lines.push(`# ${gb} GB reclaimable`);
    for (const name of DISPOSABLE) {
      lines.push(`find "$ROOT/${project.relPath}" -type d -name "${name}" -prune -exec rm -rf {} +`);
    }
    lines.push("");
    return lines;
  },
};
