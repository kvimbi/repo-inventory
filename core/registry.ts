import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { Action, Probe, Rule } from "./types.ts";

import * as p10 from "../probes/10-git-basics.ts";
import * as p15 from "../probes/15-git-fetch.ts";
import * as p20 from "../probes/20-git-sync.ts";
import * as p30 from "../probes/30-git-activity.ts";
import * as p40 from "../probes/40-stack.ts";
import * as p50 from "../probes/50-agent-tooling.ts";
import * as p55 from "../probes/55-agent-skills.ts";
import * as p60 from "../probes/60-footprint.ts";

import * as r00 from "../rules/00-default.ts";

import * as a05 from "../actions/05-init.ts";
import * as a10 from "../actions/10-publish.ts";
import * as a15 from "../actions/15-upstream.ts";
import * as a20 from "../actions/20-graduate.ts";
import * as a30 from "../actions/30-archive.ts";
import * as a40 from "../actions/40-reclaim-space.ts";
import * as a50 from "../actions/50-fetch.ts";

export interface Registry {
  probes: Probe[];
  rules: Rule[];
  actions: Action[];
}

const BUILTIN_PROBE_MODS = [p10, p15, p20, p30, p40, p50, p55, p60];
const BUILTIN_RULE_MODS = [r00];
const BUILTIN_ACTION_MODS = [a05, a10, a15, a20, a30, a40, a50];

function extractFromMods<T>(mods: Array<Record<string, unknown>>, keys: [single: string, plural: string]): T[] {
  const found: T[] = [];
  for (const mod of mods) {
    const single = mod[keys[0]];
    const plural = mod[keys[1]];
    if (single) found.push(single as T);
    if (Array.isArray(plural)) found.push(...(plural as T[]));
  }
  return found;
}

/**
 * Loads every module in a plugin directory and harvests its exports.
 */
async function collect<T>(dir: string, keys: [single: string, plural: string]): Promise<T[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const found: T[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
    try {
      const mod = (await import(pathToFileURL(resolve(dir, entry)).href)) as Record<string, unknown>;
      const single = mod[keys[0]];
      const plural = mod[keys[1]];
      if (single) found.push(single as T);
      if (Array.isArray(plural)) found.push(...(plural as T[]));
    } catch {
      // Dynamic import failed (e.g. inside packaged bundle) - skipped
    }
  }
  return found;
}

export async function loadRegistry(baseDir: string): Promise<Registry> {
  const builtinProbes = extractFromMods<Probe>(BUILTIN_PROBE_MODS, ["probe", "probes"]);
  const builtinRules = extractFromMods<Rule>(BUILTIN_RULE_MODS, ["rule", "rules"]);
  const builtinActions = extractFromMods<Action>(BUILTIN_ACTION_MODS, ["action", "actions"]);

  const [diskProbes, diskRules, diskActions] = await Promise.all([
    collect<Probe>(resolve(baseDir, "probes"), ["probe", "probes"]),
    collect<Rule>(resolve(baseDir, "rules"), ["rule", "rules"]),
    collect<Action>(resolve(baseDir, "actions"), ["action", "actions"]),
  ]);

  // Combine and deduplicate by name, preferring disk definitions over builtins if present
  const probeMap = new Map<string, Probe>();
  for (const p of [...builtinProbes, ...diskProbes]) probeMap.set(p.name, p);

  const ruleMap = new Map<string, Rule>();
  for (const r of [...builtinRules, ...diskRules]) ruleMap.set(r.name, r);

  const actionMap = new Map<string, Action>();
  for (const a of [...builtinActions, ...diskActions]) actionMap.set(a.name, a);

  const probes = Array.from(probeMap.values()).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const rules = Array.from(ruleMap.values());
  const actions = Array.from(actionMap.values());

  return { probes, rules, actions };
}
