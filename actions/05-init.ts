import type { Action, Project } from "../core/types.ts";

export const action: Action = {
  name: "init",
  label: "Git init",
  description: "Initialize a git repository, write a standard .gitignore if missing, and make an initial commit.",
  appliesTo: (project: Project) => project.isGit !== true,
  script: (project: Project, _root: string) => {
    const lines: string[] = [];
    lines.push(`# ── ${project.relPath} ──────────`);
    lines.push(`cd "$ROOT/${project.relPath}"`);
    lines.push(`git init`);
    lines.push(`if [ ! -f .gitignore ]; then`);
    lines.push(`  cat << 'EOF' > .gitignore`);
    lines.push(`# Dependencies & Build output`);
    lines.push(`node_modules/`);
    lines.push(`dist/`);
    lines.push(`build/`);
    lines.push(`out/`);
    lines.push(`.venv/`);
    lines.push(`venv/`);
    lines.push(`__pycache__/`);
    lines.push(`target/`);
    lines.push(`.cache/`);
    lines.push(`coverage/`);
    lines.push(``);
    lines.push(`# OS & Editor files`);
    lines.push(`.DS_Store`);
    lines.push(`.env`);
    lines.push(`.env.local`);
    lines.push(`EOF`);
    lines.push(`fi`);
    lines.push(`git add .`);
    lines.push(`git commit -m "Initial commit"`);
    lines.push(``);
    return lines;
  },
};
