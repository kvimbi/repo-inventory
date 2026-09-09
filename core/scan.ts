import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { discover, discoverSubprojects } from "./discover.ts";
import { loadRegistry } from "./registry.ts";
import { run, mapLimit } from "./exec.ts";
import { AnnotationStore, defaultAnnotation, isSnoozed } from "./state.ts";
import { SEVERITY_RANK } from "./types.ts";
import type { Inventory, Project, ProjectFacts, Flag, Annotation, Rule, ScanProgress, ProjectStatus } from "./types.ts";

export interface ScanOptions {
  baseDir: string;
  fetch?: boolean;
  onProgress?: (progress: ScanProgress) => void;
}

function evaluate(facts: ProjectFacts, annotation: Annotation, rules: Rule[]): Project {
  const flags: Flag[] = [];
  const snoozed = isSnoozed(annotation);
  const dimmed = snoozed || annotation.status === "stale" || annotation.status === "obsolete" || annotation.status === "archived";
  const ruleErrors: string[] = [];

  for (const rule of rules) {
    let verdict: boolean | string;
    try {
      verdict = rule.when(facts, annotation);
    } catch (error) {
      ruleErrors.push(`${rule.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (verdict === false) continue;
    if (annotation.suppressedFlags?.includes(rule.name)) continue;
    if (dimmed && rule.alwaysApply !== true) continue;
    flags.push({
      rule: rule.name,
      severity: rule.severity,
      label: rule.label,
      detail: typeof verdict === "string" ? verdict : undefined,
    });
  }

  if (ruleErrors.length > 0) {
    flags.push({
      rule: "RULE_ERROR",
      severity: "info",
      label: "Rule evaluation failed",
      detail: ruleErrors.join("; "),
    });
  }

  const probeErrors = (facts.extra?.probeErrors as string[] | undefined) ?? [];
  if (probeErrors.length > 0) {
    flags.push({
      rule: "PROBE_ERROR",
      severity: "info",
      label: "Probe failed",
      detail: probeErrors.join("; "),
    });
  }

  let risk = 0;
  for (const flag of flags) {
    const rank = SEVERITY_RANK[flag.severity];
    if (rank > risk) risk = rank;
  }

  return { ...facts, annotation, flags, risk, suppressed: dimmed };
}

const SCRATCH_DIRS = new Set(["tmp", "test", "scratch", "sandbox", "playground"]);

export function normalizeRemoteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  let normalized = trimmed
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/([^@]+@)?/, "https://")
    .replace(/^http:\/\//, "https://")
    .replace(/\.git\/?$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  normalized = normalized.replace(/^https:\/\/[^@]+@/, "https://");
  return normalized || null;
}

export function correlateDuplicates<T extends ProjectFacts>(factsList: T[]): void {
  for (const f of factsList) {
    delete f.duplicateOf;
    delete f.isDuplicateCopy;
  }

  const eligible = factsList.filter((f) => !f.isSubProject && (f.isGit || f.hasRemote || f.rootCommitSha));
  const clusters: Array<Set<T>> = [];

  // Group by normalized remote URL
  const remoteMap = new Map<string, T[]>();
  for (const f of eligible) {
    const normUrl = normalizeRemoteUrl(f.remoteUrl);
    if (normUrl) {
      const list = remoteMap.get(normUrl) ?? [];
      list.push(f);
      remoteMap.set(normUrl, list);
    }
  }

  for (const list of remoteMap.values()) {
    if (list.length >= 2) {
      clusters.push(new Set(list));
    }
  }

  // Group by rootCommitSha for repositories sharing initial commit history
  const rootCommitMap = new Map<string, T[]>();
  for (const f of eligible) {
    if (f.rootCommitSha) {
      const list = rootCommitMap.get(f.rootCommitSha) ?? [];
      list.push(f);
      rootCommitMap.set(f.rootCommitSha, list);
    }
  }

  for (const list of rootCommitMap.values()) {
    if (list.length >= 2) {
      let existingCluster: Set<T> | undefined;
      for (const item of list) {
        existingCluster = clusters.find((c) => c.has(item));
        if (existingCluster) break;
      }
      if (existingCluster) {
        for (const item of list) existingCluster.add(item);
      } else {
        clusters.push(new Set(list));
      }
    }
  }

  for (const clusterSet of clusters) {
    const items = Array.from(clusterSet);
    if (items.length < 2) continue;

    const sorted = [...items].sort((a, b) => {
      const aScratch = SCRATCH_DIRS.has(a.group) ? 1 : 0;
      const bScratch = SCRATCH_DIRS.has(b.group) ? 1 : 0;
      if (aScratch !== bScratch) return aScratch - bScratch;

      const aHasRemote = a.hasRemote ? 0 : 1;
      const bHasRemote = b.hasRemote ? 0 : 1;
      if (aHasRemote !== bHasRemote) return aHasRemote - bHasRemote;

      const aDirty = (a.dirtyFiles ?? 0) + (a.ahead ?? 0);
      const bDirty = (b.dirtyFiles ?? 0) + (b.ahead ?? 0);
      if (aDirty !== bDirty) return aDirty - bDirty;

      const aAge = a.lastCommitAgeDays ?? 999999;
      const bAge = b.lastCommitAgeDays ?? 999999;
      if (aAge !== bAge) return aAge - bAge;

      return a.relPath.localeCompare(b.relPath);
    });

    const canonical = sorted[0]!;

    for (const item of items) {
      item.duplicateOf = items.filter((x) => x.relPath !== item.relPath).map((x) => x.relPath);
      item.isDuplicateCopy = item.relPath !== canonical.relPath;
    }
  }
}

export async function scan(options: ScanOptions): Promise<Inventory> {
  const startedAt = Date.now();
  options.onProgress?.({
    phase: "discovering",
    message: "Loading configuration and probes…",
  });
  const config = await loadConfig(options.baseDir);
  const registry = await loadRegistry(options.baseDir);
  const store = await AnnotationStore.open(options.baseDir);

  const rootsDesc = config.roots && config.roots.length > 0 ? config.roots.join(", ") : config.root;
  options.onProgress?.({
    phase: "discovering",
    message: `Searching for repositories in ${rootsDesc}…`,
  });
  const discovered = await discover(config);
  const pruneDirs = new Set(config.pruneDirs);

  options.onProgress?.({
    phase: "probing",
    done: 0,
    total: discovered.length,
    message: `Discovered ${discovered.length} projects, analyzing facts…`,
  });

  let done = 0;
  const facts = await mapLimit(discovered, 8, async (initial) => {
    let merged: ProjectFacts = { ...initial };
    const errors: string[] = [];

    for (const probe of registry.probes) {
      if (probe.appliesTo && !probe.appliesTo(merged)) continue;
      try {
        const produced = await probe.detect({
          path: merged.path,
          facts: merged,
          root: config.root,
          fetch: options.fetch === true,
          run: (cmd, args) => run(merged.path, cmd, args),
          pruneDirs,
        });
        if (produced) merged = { ...merged, ...produced };
      } catch (error) {
        errors.push(`${probe.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length > 0) {
      merged.extra = { ...merged.extra, probeErrors: errors };
    }
    done += 1;
    options.onProgress?.({
      phase: "probing",
      done,
      total: discovered.length,
      current: merged.relPath,
      message: `Analyzing ${merged.name} (${done}/${discovered.length})`,
    });
    return merged;
  });

  // Establish parent/child monorepo linkages
  const projectMap = new Map<string, ProjectFacts>();
  for (const f of facts) {
    projectMap.set(f.relPath, f);
  }

  for (const f of facts) {
    if (f.isSubProject && f.nestedIn) {
      const parent = projectMap.get(f.nestedIn);
      if (parent) {
        f.monorepoRootId = parent.id;
        f.projectType = "sub-project";
        parent.isMonorepo = true;
        parent.projectType = "monorepo-root";
        parent.subProjectPaths = parent.subProjectPaths ?? [];
        if (!parent.subProjectPaths.includes(f.relPath)) {
          parent.subProjectPaths.push(f.relPath);
        }
        parent.subProjectCount = parent.subProjectPaths.length;
      }
    }
  }

  for (const f of facts) {
    if (!f.projectType) {
      f.projectType = f.isMonorepo ? "monorepo-root" : "standalone";
    }
  }

  correlateDuplicates(facts);

  await store.touchSeen(facts.map((f) => ({ id: f.id, relPath: f.relPath })));

  options.onProgress?.({
    phase: "evaluating",
    done: facts.length,
    total: facts.length,
    message: "Evaluating rules and annotations…",
  });

  // Build projects with flags
  let projects: Project[] = facts.map((f) => {
    const annotation = store.get(f.id);
    return evaluate(f, annotation, registry.rules);
  });

  // Sort: descending risk, then ascending relPath
  projects.sort((a, b) => {
    if (b.risk !== a.risk) return b.risk - a.risk;
    return a.relPath.localeCompare(b.relPath);
  });

  const inventory: Inventory = {
    version: 1,
    root: config.root,
    roots: config.roots,
    scannedAt: new Date().toISOString(),
    fetched: options.fetch === true,
    durationMs: Date.now() - startedAt,
    projects,
    probes: registry.probes.map((p) => p.name),
    rules: registry.rules.map((r) => ({
      name: r.name,
      severity: r.severity,
      label: r.label,
      alwaysApply: r.alwaysApply === true,
    })),
    actions: registry.actions.map((a) => ({
      name: a.name,
      label: a.label,
      description: a.description,
    })),
  };

  // Write atomically
  const dataDir = resolve(options.baseDir, "data");
  await mkdir(dataDir, { recursive: true });
  const tempPath = resolve(dataDir, "inventory.json.tmp");
  const finalPath = resolve(dataDir, "inventory.json");
  await writeFile(tempPath, JSON.stringify(inventory, null, 2));
  await rename(tempPath, finalPath);

  options.onProgress?.({
    phase: "ready",
    done: projects.length,
    total: projects.length,
    message: "Inventory ready",
  });

  return inventory;
}

export async function readInventory(baseDir: string): Promise<Inventory | null> {
  try {
    const content = await readFile(resolve(baseDir, "data/inventory.json"), "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const inv = parsed as Record<string, unknown>;
    if (!Array.isArray(inv.projects) || inv.projects.length === 0) return null;

    let needsSave = false;
    if (inv.version !== 1) {
      inv.version = 1;
      needsSave = true;
    }

    const store = await AnnotationStore.open(baseDir);
    const registry = await loadRegistry(baseDir);

    correlateDuplicates(inv.projects as ProjectFacts[]);

    for (const p of inv.projects as Project[]) {
      if (p.relPath && p.id !== p.relPath) {
        p.id = p.relPath;
        needsSave = true;
      }
      if (p.isSubProject && p.nestedIn && p.monorepoRootId !== p.nestedIn) {
        p.monorepoRootId = p.nestedIn;
        needsSave = true;
      }
      // Re-evaluate annotations to ensure fresh state
      const currentAnnotation = store.get(p.id);
      const evaluated = evaluate(p as ProjectFacts, currentAnnotation, registry.rules);
      if (
        p.annotation?.status !== evaluated.annotation.status ||
        p.annotation?.favourite !== evaluated.annotation.favourite ||
        p.annotation?.todo !== evaluated.annotation.todo ||
        p.annotation?.note !== evaluated.annotation.note ||
        p.risk !== evaluated.risk
      ) {
        p.annotation = evaluated.annotation;
        p.flags = evaluated.flags;
        p.risk = evaluated.risk;
        p.suppressed = evaluated.suppressed;
        needsSave = true;
      }
    }

    if (needsSave) {
      const dataDir = resolve(baseDir, "data");
      await mkdir(dataDir, { recursive: true });
      const tempPath = resolve(dataDir, "inventory.json.tmp");
      const finalPath = resolve(dataDir, "inventory.json");
      await writeFile(tempPath, JSON.stringify(inv, null, 2));
      await rename(tempPath, finalPath);
    }

    return inv as unknown as Inventory;
  } catch {
    return null;
  }
}

export interface QuickRefreshOptions {
  baseDir: string;
  inventory: Inventory;
  onProgress?: (progress: ScanProgress) => void;
}

export async function quickRefresh(options: QuickRefreshOptions): Promise<Inventory> {
  const startedAt = Date.now();
  const config = await loadConfig(options.baseDir);
  const registry = await loadRegistry(options.baseDir);
  const store = await AnnotationStore.open(options.baseDir);
  const pruneDirs = new Set(config.pruneDirs);

  // Identify projects that are active/stale/unknown vs archived/obsolete
  const isArchivedOrDeprecated = (status: ProjectStatus) => status === "archived" || status === "obsolete";

  const toProbe: Project[] = [];
  const skipped: Project[] = [];

  for (const project of options.inventory.projects) {
    project.id = project.relPath;
    const ann = store.get(project.id);
    if (isArchivedOrDeprecated(ann.status)) {
      skipped.push(project);
    } else {
      toProbe.push(project);
    }
  }

  options.onProgress?.({
    phase: "refreshing",
    done: 0,
    total: toProbe.length,
    message: `Quick refreshing ${toProbe.length} active projects…`,
  });

  let doneCount = 0;
  const probedFacts = await mapLimit(toProbe, 8, async (target) => {
    const { annotation: _, flags: __, risk: ___, suppressed: ____, ...facts } = target;
    let merged: ProjectFacts = { ...(facts as ProjectFacts), id: target.relPath };

    const errors: string[] = [];
    for (const probe of registry.probes) {
      if (probe.appliesTo && !probe.appliesTo(merged)) continue;
      try {
        const produced = await probe.detect({
          path: merged.path,
          facts: merged,
          root: config.root,
          fetch: false,
          run: (cmd, args) => run(merged.path, cmd, args),
          pruneDirs,
          quick: true,
        });
        if (produced) merged = { ...merged, ...produced };
      } catch (error) {
        errors.push(`${probe.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length > 0) {
      merged.extra = { ...merged.extra, probeErrors: errors };
    }

    doneCount++;
    options.onProgress?.({
      phase: "probing",
      done: doneCount,
      total: toProbe.length,
      current: merged.relPath,
      message: `Checking ${merged.name} (${doneCount}/${toProbe.length})`,
    });

    return merged;
  });

  const skippedFacts = skipped.map((p) => {
    const { annotation: _, flags: __, risk: ___, suppressed: ____, ...facts } = p;
    return { ...(facts as ProjectFacts), id: p.relPath };
  });

  const allFacts = [...probedFacts, ...skippedFacts];
  correlateDuplicates(allFacts);

  const allProjects = allFacts.map((f) => {
    const currentAnnotation = store.get(f.id);
    return evaluate(f, currentAnnotation, registry.rules);
  });

  // Sort same way as scan
  allProjects.sort((a, b) => {
    if (b.risk !== a.risk) return b.risk - a.risk;
    return a.relPath.localeCompare(b.relPath);
  });

  await store.touchSeen(allProjects.map((p) => ({ id: p.id, relPath: p.relPath })));

  const refreshedInventory: Inventory = {
    ...options.inventory,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    projects: allProjects,
    rules: registry.rules.map((r) => ({
      name: r.name,
      severity: r.severity,
      label: r.label,
      alwaysApply: r.alwaysApply === true,
    })),
    actions: registry.actions.map((a) => ({
      name: a.name,
      label: a.label,
      description: a.description,
    })),
  };

  // Write atomically
  const dataDir = resolve(options.baseDir, "data");
  await mkdir(dataDir, { recursive: true });
  const tempPath = resolve(dataDir, "inventory.json.tmp");
  const finalPath = resolve(dataDir, "inventory.json");
  await writeFile(tempPath, JSON.stringify(refreshedInventory, null, 2));
  await rename(tempPath, finalPath);

  options.onProgress?.({
    phase: "ready",
    done: allProjects.length,
    total: allProjects.length,
    message: "Inventory ready",
  });

  return refreshedInventory;
}

export async function refresh(baseDir: string, inventory: Inventory): Promise<Inventory> {
  const registry = await loadRegistry(baseDir);
  const store = await AnnotationStore.open(baseDir);

  const rawFacts = inventory.projects.map((p) => {
    const { annotation: _, flags: __, risk: ___, suppressed: ____, ...facts } = p;
    return { ...(facts as ProjectFacts), id: p.relPath };
  });

  correlateDuplicates(rawFacts);

  const projects: Project[] = rawFacts.map((factsWithId) => {
    const currentAnnotation = store.get(factsWithId.id);
    return evaluate(factsWithId, currentAnnotation, registry.rules);
  });

  // Sort same way as scan
  projects.sort((a, b) => {
    if (b.risk !== a.risk) return b.risk - a.risk;
    return a.relPath.localeCompare(b.relPath);
  });

  return {
    ...inventory,
    projects,
    rules: registry.rules.map((r) => ({
      name: r.name,
      severity: r.severity,
      label: r.label,
      alwaysApply: r.alwaysApply === true,
    })),
    actions: registry.actions.map((a) => ({
      name: a.name,
      label: a.label,
      description: a.description,
    })),
  };
}

export async function reprobeProject(
  baseDir: string,
  projectId: string,
  inventory: Inventory,
  fetchRemotes: boolean = false,
): Promise<{ inventory: Inventory; project: Project | null }> {
  const config = await loadConfig(baseDir);
  const registry = await loadRegistry(baseDir);
  const store = await AnnotationStore.open(baseDir);
  const pruneDirs = new Set(config.pruneDirs);

  const idx = inventory.projects.findIndex((p) => p.id === projectId || p.relPath === projectId);
  if (idx === -1) return { inventory, project: null };

  const target = inventory.projects[idx]!;
  let merged: ProjectFacts = {
    kind: target.kind,
    relPath: target.relPath,
    group: target.group,
    name: target.name,
    path: target.path,
    depth: target.depth,
    nestedIn: target.nestedIn,
    id: target.relPath,
    isGit: target.isGit,
    isSubProject: target.isSubProject,
    projectType: target.projectType,
    monorepoRootId: target.nestedIn || target.monorepoRootId,
    isMonorepo: target.isMonorepo,
    subProjectPaths: target.subProjectPaths,
    subProjectCount: target.subProjectCount,
    manifests: target.manifests,
  };

  const errors: string[] = [];
  for (const probe of registry.probes) {
    if (probe.appliesTo && !probe.appliesTo(merged)) continue;
    try {
      const produced = await probe.detect({
        path: merged.path,
        facts: merged,
        root: config.root,
        fetch: fetchRemotes,
        run: (cmd, args) => run(merged.path, cmd, args),
        pruneDirs,
      });
      if (produced) merged = { ...merged, ...produced };
    } catch (error) {
      errors.push(`${probe.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length > 0) {
    merged.extra = { ...merged.extra, probeErrors: errors };
  }

  if (target.id !== merged.id) {
    const oldAnnotation = store.get(target.id);
    if (oldAnnotation.status !== "unknown" || oldAnnotation.note !== "" || oldAnnotation.alias) {
      await store.update(merged.id, oldAnnotation);
    }
  }

  const isMonorepoParent =
    merged.isMonorepo === true ||
    target.isMonorepo === true ||
    merged.projectType === "monorepo-root" ||
    target.projectType === "monorepo-root" ||
    (merged.manifests?.includes("nx.json") ?? false) ||
    (merged.frameworks?.includes("nx") ?? false) ||
    (target.subProjectPaths && target.subProjectPaths.length > 0) ||
    inventory.projects.some((p) => p.nestedIn === target.relPath || p.monorepoRootId === target.id);

  let childFacts: ProjectFacts[] = [];
  if (isMonorepoParent) {
    const discoveredChildren = await discoverSubprojects(
      merged.path,
      merged.relPath,
      config,
      merged.manifests ?? target.manifests ?? [],
    );

    childFacts = await mapLimit(discoveredChildren, 8, async (initial) => {
      let childMerged: ProjectFacts = { ...initial };
      const childErrors: string[] = [];

      for (const probe of registry.probes) {
        if (probe.appliesTo && !probe.appliesTo(childMerged)) continue;
        try {
          const produced = await probe.detect({
            path: childMerged.path,
            facts: childMerged,
            root: config.root,
            fetch: false,
            run: (cmd, args) => run(childMerged.path, cmd, args),
            pruneDirs,
          });
          if (produced) childMerged = { ...childMerged, ...produced };
        } catch (error) {
          childErrors.push(`${probe.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (childErrors.length > 0) {
        childMerged.extra = { ...childMerged.extra, probeErrors: childErrors };
      }

      childMerged.monorepoRootId = merged.id;
      childMerged.isSubProject = true;
      childMerged.projectType = "sub-project";
      childMerged.nestedIn = merged.relPath;

      return childMerged;
    });

    if (childFacts.length > 0) {
      merged.isMonorepo = true;
      merged.projectType = "monorepo-root";
      merged.subProjectPaths = childFacts.map((c) => c.relPath);
      merged.subProjectCount = childFacts.length;
    } else if (merged.isMonorepo && (!target.subProjectPaths || target.subProjectPaths.length === 0)) {
      merged.subProjectPaths = [];
      merged.subProjectCount = 0;
    }

    await store.touchSeen([
      { id: merged.id, relPath: merged.relPath },
      ...childFacts.map((c) => ({ id: c.id, relPath: c.relPath })),
    ]);
  }

  const otherExistingProjects = inventory.projects.filter(
    (p) =>
      p.id !== target.id &&
      p.path !== target.path &&
      p.nestedIn !== target.relPath &&
      p.monorepoRootId !== target.id &&
      !(p.isSubProject && p.relPath.startsWith(`${target.relPath}/`)),
  );

  const allCandidateFacts: ProjectFacts[] = [
    ...otherExistingProjects.map((p) => {
      const { annotation: _, flags: __, risk: ___, suppressed: ____, ...facts } = p;
      return { ...(facts as ProjectFacts), id: p.relPath };
    }),
    merged,
    ...childFacts,
  ];

  correlateDuplicates(allCandidateFacts);

  const newProjects = allCandidateFacts.map((f) => {
    const ann = store.get(f.id);
    return evaluate(f, ann, registry.rules);
  });

  const updatedProject = newProjects.find((p) => p.id === merged.id) ?? evaluate(merged, store.get(merged.id), registry.rules);

  newProjects.sort((a, b) => {
    if (b.risk !== a.risk) return b.risk - a.risk;
    return a.relPath.localeCompare(b.relPath);
  });

  const newInventory: Inventory = {
    ...inventory,
    projects: newProjects,
  };

  const dataDir = resolve(baseDir, "data");
  await mkdir(dataDir, { recursive: true });
  const tempPath = resolve(dataDir, "inventory.json.tmp");
  const finalPath = resolve(dataDir, "inventory.json");
  await writeFile(tempPath, JSON.stringify(newInventory, null, 2));
  await rename(tempPath, finalPath);

  return { inventory: newInventory, project: updatedProject };
}


