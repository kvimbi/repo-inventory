import { spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { IDE_LAUNCHERS } from "../../core/ides.ts";
import type { OpenConfigurationResult } from "../../core/types.ts";
import type { AgentToolsCatalog } from "./catalog.ts";

export type SpawnFunction = (
  command: string,
  args: ReadonlyArray<string>,
  options: { shell?: boolean },
) => { on: (event: string, listener: (...args: unknown[]) => void) => unknown };

export async function openConfiguration(
  catalog: AgentToolsCatalog,
  ref: string,
  action: "editor" | "reveal",
  ideOrSpawn?: string | SpawnFunction,
  spawnFn: SpawnFunction = spawn,
): Promise<OpenConfigurationResult> {
  const ide = typeof ideOrSpawn === "string" ? ideOrSpawn : undefined;
  const effectiveSpawn = typeof ideOrSpawn === "function" ? ideOrSpawn : spawnFn;
  if (action !== "editor" && action !== "reveal") {
    return { ok: false, message: `Invalid action: ${String(action)}` };
  }

  const item = await catalog.lookupRef(ref);
  if (!item) {
    return { ok: false, message: `Unknown configuration reference: ${ref}` };
  }

  if (!["configuration", "instruction", "skill", "subagent"].includes(item.kind)) {
    return {
      ok: false,
      message: `Resource reference ${ref} is not an opener-eligible reference (found: ${item.kind})`,
    };
  }

  try {
    if (!existsSync(item.path)) {
      return { ok: false, message: `File does not exist: ${item.path}` };
    }
    const st = statSync(item.path);
    if (!st.isFile()) {
      return { ok: false, message: `Target is not a regular file: ${item.path}` };
    }
    const currentRealpath = realpathSync(item.path);
    if (currentRealpath !== item.canonicalPath) {
      return {
        ok: false,
        message: `File canonical path mismatch: expected ${item.canonicalPath}, resolved ${currentRealpath}`,
      };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  if (ide !== undefined && !IDE_LAUNCHERS.some((candidate) => candidate.id === ide)) {
    return { ok: false, message: `Unknown IDE: ${ide}` };
  }

  const selected = ide ? IDE_LAUNCHERS.find((candidate) => candidate.id === ide) : undefined;
  const revealInFinder = action === "reveal" || selected?.id === "finder";
  const launcherCommand = revealInFinder ? (process.platform === "darwin" ? "/usr/bin/open" : "open") : (selected?.command ?? (process.platform === "darwin" ? "/usr/bin/open" : "open"));
  const launcherArgs = revealInFinder ? ["-R"] : selected?.args ?? (selected ? [] : ["-t"]);
  const home = homedir();
  const resolveCommand = (command: string) => command.startsWith("~/") ? resolve(home, command.slice(2)) : command;
  const candidates = action === "editor" && selected && !revealInFinder
    ? [launcherCommand, ...(selected.fallbackCommands ?? []).map(resolveCommand)]
    : [launcherCommand];
  const args = [...launcherArgs, item.canonicalPath];

  return new Promise<OpenConfigurationResult>((resolveResult) => {
    let index = 0;
    let lastError = "";
    const tryNext = () => {
      const command = candidates[index++];
      if (!command) {
        resolveResult({ ok: false, message: `Failed to launch ${selected?.label ?? "text editor"}: ${lastError || "command failed"}` });
        return;
      }
      try {
        const child = effectiveSpawn(command, args, { shell: false });
        let settled = false;
        child.on("error", (err: unknown) => {
          if (settled) return;
          settled = true;
          lastError = err instanceof Error ? err.message : String(err);
          tryNext();
        });
        child.on("close", (code) => {
          if (settled) return;
          settled = true;
          if (code === 0) resolveResult({ ok: true });
          else {
            lastError = `${command} exited with code ${code}`;
            tryNext();
          }
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        tryNext();
      }
    };
    tryNext();
  });
}
