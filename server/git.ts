import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { loadConfig } from "../core/config.ts";
import { run } from "../core/exec.ts";
import { reprobeProject } from "../core/scan.ts";
import type { Inventory, ProjectFacts } from "../core/types.ts";

export async function ensureSshHostAlias(
  projectPath: string,
  baseDir: string,
  currentInventory: Inventory | null,
  remoteName = "origin",
): Promise<string | null> {
  const config = await loadConfig(baseDir);
  let sshHost = config.sshHost;
  if (!sshHost && currentInventory) {
    for (const p of currentInventory.projects) {
      if (p.remoteUrl && p.remoteUrl.startsWith("git@github") && !p.remoteUrl.startsWith("git@github.com:")) {
        const match = /^git@([^:/]+):/.exec(p.remoteUrl);
        if (match?.[1] && match[1].startsWith("github")) {
          sshHost = match[1];
          break;
        }
      }
    }
  }

  if (!sshHost) {
    const userRes = await run(projectPath, "gh", ["api", "user", "-q", ".login"], 15_000, true);
    if (userRes.ok && userRes.stdout.trim() === "kvimbi") {
      sshHost = "github-kvimbi";
    }
  }

  const originRes = await run(projectPath, "git", ["remote", "get-url", remoteName], 15_000, true);
  if (!originRes.ok || !originRes.stdout.trim()) {
    return sshHost ?? null;
  }

  const currentOrigin = originRes.stdout.trim();
  if (sshHost) {
    let newOrigin: string | null = null;
    if (currentOrigin.startsWith("git@github.com:")) {
      newOrigin = currentOrigin.replace("git@github.com:", `git@${sshHost}:`);
    } else if (currentOrigin.includes("dev.azure.com") || (!currentOrigin.includes(sshHost) && currentOrigin.startsWith("git@"))) {
      const repoName = projectPath.split("/").pop();
      const userRes = await run(projectPath, "gh", ["api", "user", "-q", ".login"], 15_000, true);
      const owner = userRes.ok && userRes.stdout.trim() ? userRes.stdout.trim() : "kvimbi";
      newOrigin = `git@${sshHost}:${owner}/${repoName}.git`;
    }

    if (newOrigin && newOrigin !== currentOrigin) {
      await run(projectPath, "git", ["remote", "set-url", remoteName, newOrigin], 15_000, true);
    }
  }

  return sshHost ?? null;
}

export async function executeGitAction(
  action: string,
  project: ProjectFacts,
  baseDir: string,
  current: Inventory,
): Promise<{ ok: boolean; inventory: Inventory; project: ProjectFacts; error?: string; code?: number }> {
  let fetchRemotes = false;

  if (action === "init") {
    const initRes = await run(project.path, "git", ["init"], 30_000, true);
    if (!initRes.ok) {
      const fullOutput = [initRes.stderr.trim(), initRes.stdout.trim()].filter(Boolean).join("\n");
      return { ok: false, inventory: current, project, error: `git init failed:\n${fullOutput || "command failed"}`, code: 500 };
    }

    const gitignorePath = resolve(project.path, ".gitignore");
    if (!existsSync(gitignorePath)) {
      const gitignoreContent = `# Dependencies & Build output
node_modules/
dist/
build/
out/
.venv/
venv/
__pycache__/
target/
.cache/
coverage/

# OS & Editor files
.DS_Store
.env
.env.local
`;
      await writeFile(gitignorePath, gitignoreContent, "utf8");
    }

    const addRes = await run(project.path, "git", ["add", "."], 30_000, true);
    if (!addRes.ok) {
      const fullOutput = [addRes.stderr.trim(), addRes.stdout.trim()].filter(Boolean).join("\n");
      return { ok: false, inventory: current, project, error: `git add failed:\n${fullOutput || "command failed"}`, code: 500 };
    }

    const commitRes = await run(project.path, "git", ["commit", "-m", "Initial commit"], 30_000, true);
    if (!commitRes.ok) {
      const fullOutput = [commitRes.stderr.trim(), commitRes.stdout.trim()].filter(Boolean).join("\n");
      return { ok: false, inventory: current, project, error: `git commit failed:\n${fullOutput || "command failed"}`, code: 500 };
    }
  } else if (action === "publish") {
    const name = project.name;
    const branch = project.branch ?? "main";

    const sshHost = await ensureSshHostAlias(project.path, baseDir, current, "origin");

    // 1. Create GitHub repo via gh CLI
    const ghRes = await run(project.path, "gh", ["repo", "create", name, "--private", "--source=."], 30_000, true);
    if (!ghRes.ok) {
      const fullOutput = [ghRes.stderr.trim(), ghRes.stdout.trim()].filter(Boolean).join("\n");
      const isAlreadyExists = /already exists/i.test(fullOutput);
      if (!isAlreadyExists) {
        return {
          ok: false,
          inventory: current,
          project,
          error: `gh repo create failed:\n${fullOutput || "command failed"}`,
          code: 500,
        };
      }
    }

    // 2. Ensure origin remote URL is configured and uses SSH host alias if present
    const originRes = await run(project.path, "git", ["remote", "get-url", "origin"], 30_000, true);
    let currentOrigin = originRes.ok ? originRes.stdout.trim() : null;

    if (!currentOrigin) {
      let owner = "kvimbi";
      const userRes = await run(project.path, "gh", ["api", "user", "-q", ".login"], 30_000, true);
      if (userRes.ok && userRes.stdout.trim()) {
        owner = userRes.stdout.trim();
      }
      const defaultHost = sshHost ?? "github.com";
      const newUrl = `git@${defaultHost}:${owner}/${name}.git`;
      await run(project.path, "git", ["remote", "add", "origin", newUrl], 30_000, true);
      currentOrigin = newUrl;
    } else if (sshHost && (currentOrigin.startsWith("git@github.com:") || currentOrigin.includes("dev.azure.com"))) {
      let owner = "kvimbi";
      const userRes = await run(project.path, "gh", ["api", "user", "-q", ".login"], 30_000, true);
      if (userRes.ok && userRes.stdout.trim()) {
        owner = userRes.stdout.trim();
      }
      const newOrigin = `git@${sshHost}:${owner}/${name}.git`;
      await run(project.path, "git", ["remote", "set-url", "origin", newOrigin], 30_000, true);
    }

    // 3. Push branch to remote
    const pushRes = await run(project.path, "git", ["push", "-u", "origin", branch], 30_000, true);
    if (!pushRes.ok) {
      const fullOutput = [pushRes.stderr.trim(), pushRes.stdout.trim()].filter(Boolean).join("\n");
      return {
        ok: false,
        inventory: current,
        project,
        error: `git push failed:\n${fullOutput || "push failed"}`,
        code: 500,
      };
    }

    fetchRemotes = true;
  } else if (action === "set-upstream") {
    const remote = project.remoteName ?? "origin";
    const branch = project.branch ?? "main";
    await ensureSshHostAlias(project.path, baseDir, current, remote);
    const pushRes = await run(project.path, "git", ["push", "-u", remote, branch], 30_000, true);
    if (!pushRes.ok) {
      const fullOutput = [pushRes.stderr.trim(), pushRes.stdout.trim()].filter(Boolean).join("\n");
      return { ok: false, inventory: current, project, error: `git push -u failed:\n${fullOutput || "command failed"}`, code: 500 };
    }
    fetchRemotes = true;
  } else {
    return { ok: false, inventory: current, project, error: `unsupported execution action: ${action}`, code: 400 };
  }

  const { inventory: updatedInventory, project: updatedProject } = await reprobeProject(
    baseDir,
    project.id,
    current,
    fetchRemotes,
  );

  if (!updatedProject) {
    return { ok: false, inventory: current, project, error: "project not found after executing action", code: 404 };
  }

  return { ok: true, inventory: updatedInventory, project: updatedProject };
}
