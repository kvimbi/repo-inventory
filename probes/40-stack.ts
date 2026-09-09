import type { Probe } from "../core/types.ts";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const MANIFESTS: Array<[string | RegExp, string]> = [
  ["package.json", "node"],
  ["deno.json", "deno"],
  ["deno.jsonc", "deno"],
  ["pyproject.toml", "python"],
  ["requirements.txt", "python"],
  ["Pipfile", "python"],
  ["setup.py", "python"],
  ["uv.lock", "python"],
  [/\.csproj$/, "dotnet"],
  [/\.fsproj$/, "dotnet"],
  [/\.sln$/, "dotnet"],
  ["go.mod", "go"],
  ["Cargo.toml", "rust"],
  ["pom.xml", "jvm"],
  ["build.gradle", "jvm"],
  ["build.gradle.kts", "jvm"],
  ["Package.swift", "swift"],
  [/\.xcodeproj$/, "swift"],
  [/\.xcworkspace$/, "swift"],
  ["pubspec.yaml", "dart"],
  ["Gemfile", "ruby"],
  ["composer.json", "php"],
  ["mix.exs", "elixir"],
  ["Dockerfile", "docker"],
  [/docker-compose\.y.*ml$/, "docker"],
  [/\.tf$/, "terraform"],
  [/\.tfvars$/, "terraform"],
  ["Chart.yaml", "kubernetes"],
  [/kustomization\.y.*ml$/, "kubernetes"],
  [/skaffold\.y.*ml$/, "kubernetes"],
];

const NODE_FRAMEWORKS: Array<[string, string]> = [
  ["react", "react"],
  ["next", "nextjs"],
  ["vue", "vue"],
  ["svelte", "svelte"],
  ["@angular/core", "angular"],
  ["react-native", "react-native"],
  ["expo", "react-native"],
  ["electron", "electron"],
  ["express", "express"],
  ["fastify", "fastify"],
  ["@nestjs/core", "nestjs"],
  ["vite", "vite"],
  ["typescript", "typescript"],
  ["tailwindcss", "tailwind"],
  ["@modelcontextprotocol/sdk", "mcp"],
  ["vitest", "tests"],
  ["jest", "tests"],
];

const PYTHON_FRAMEWORKS: Array<[string, string]> = [
  ["fastapi", "fastapi"],
  ["django", "django"],
  ["flask", "flask"],
  ["pydantic", "pydantic"],
  ["streamlit", "streamlit"],
  ["langchain", "langchain"],
  ["mcp", "mcp"],
  ["pandas", "pandas"],
];

async function walkManifests(
  dir: string,
  root: string,
  prune: Set<string>,
  maxDepth: number,
  currentDepth = 0,
): Promise<string[]> {
  if (currentDepth > maxDepth) return [];
  const entries: string[] = [];
  try {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        if (prune.has(item.name)) continue;
        const sub = await walkManifests(
          join(dir, item.name),
          root,
          prune,
          maxDepth,
          currentDepth + 1,
        );
        entries.push(...sub);
      } else {
        for (const [pattern, _ecosystem] of MANIFESTS) {
          if (typeof pattern === "string") {
            if (item.name === pattern) {
              entries.push(relative(root, join(dir, item.name)));
              break;
            }
          } else if (pattern.test(item.name)) {
            entries.push(relative(root, join(dir, item.name)));
            break;
          }
        }
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return entries;
}

export const probe: Probe = {
  name: "stack",
  order: 40,
  async detect({ path, pruneDirs, facts, quick }) {
    if (quick && facts.stack !== undefined) {
      return {};
    }
    const manifests = await walkManifests(path, path, pruneDirs, 3);
    const stack = new Set<string>();
    const frameworks = new Set<string>();

    // Detect ecosystems from manifests
    for (const m of manifests) {
      const basename = m.split(/[\\/]/).pop() ?? m;
      for (const [pattern, ecosystem] of MANIFESTS) {
        if (typeof pattern === "string") {
          if (basename === pattern) {
            stack.add(ecosystem);
            break;
          }
        } else if (pattern.test(basename)) {
          stack.add(ecosystem);
          break;
        }
      }
    }

    // Framework detection from package.json files
    const packageJsons = manifests.filter((m) => m.endsWith("package.json"));
    let isMonorepo = false;
    for (const pj of packageJsons) {
      try {
        const content = await readFile(join(path, pj), "utf-8");
        const json = JSON.parse(content) as Record<string, unknown>;
        const deps = Object.keys((json.dependencies as Record<string, unknown>) ?? {});
        const devDeps = Object.keys((json.devDependencies as Record<string, unknown>) ?? {});
        const peerDeps = Object.keys((json.peerDependencies as Record<string, unknown>) ?? {});
        const allDeps = new Set([...deps, ...devDeps, ...peerDeps]);
        for (const [dep, fw] of NODE_FRAMEWORKS) {
          if (allDeps.has(dep)) frameworks.add(fw);
        }
        // Check for workspaces at root
        if (pj === "package.json" && "workspaces" in json) {
          isMonorepo = true;
          frameworks.add("workspaces");
        }
      } catch {
        // malformed JSON ignored
      }
    }

    // Framework detection from Python manifests
    const pythonManifests = manifests.filter(
      (m) => m.endsWith("pyproject.toml") || m.endsWith("requirements.txt"),
    );
    for (const pm of pythonManifests) {
      try {
        const content = await readFile(join(path, pm), "utf-8");
        const lower = content.toLowerCase();
        for (const [substr, fw] of PYTHON_FRAMEWORKS) {
          if (lower.includes(substr)) frameworks.add(fw);
        }
      } catch {
        // ignore
      }
    }

    // Monorepo detection from root files
    if (manifests.some((m) => m.endsWith("project.json"))) {
      frameworks.add("nx");
    }

    const rootFiles = ["nx.json", "pnpm-workspace.yaml", "turbo.json", "lerna.json"];
    for (const f of rootFiles) {
      try {
        await stat(join(path, f));
        isMonorepo = true;
        if (f === "nx.json") frameworks.add("nx");
        else if (f === "pnpm-workspace.yaml") frameworks.add("pnpm-workspace");
        else if (f === "turbo.json") frameworks.add("turborepo");
        else if (f === "lerna.json") frameworks.add("lerna");
      } catch {
        // file does not exist
      }
    }

    const out: Record<string, unknown> = {};
    if (stack.size > 0) out.stack = Array.from(stack).sort();
    if (frameworks.size > 0) out.frameworks = Array.from(frameworks).sort();
    if (manifests.length > 0) out.manifests = manifests.slice(0, 40).sort();
    if (isMonorepo) out.isMonorepo = true;
    if (packageJsons.length > 1) out.packageCount = packageJsons.length;

    return out;
  },
};
