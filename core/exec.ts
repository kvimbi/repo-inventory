import { execFile } from "node:child_process";
import { ensureAugmentedEnv } from "./env.ts";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command in `cwd` and resolves rather than rejects on failure.
 *
 * Scanning a messy folder means constantly hitting repos where a command is
 * simply not applicable — an empty repo with no commits, a branch with no
 * upstream. Those are expected answers, not exceptions, so the caller reads
 * `ok` instead of wrapping every call in try/catch.
 */
export function run(
  cwd: string,
  cmd: string,
  args: string[],
  timeoutMs = 15_000,
  interactive = false,
): Promise<RunResult> {
  ensureAugmentedEnv();
  const env = interactive
    ? { ...process.env }
    : {
        ...process.env,
        // Never let a scan block on a credential or SSH host-key prompt.
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "/usr/bin/true",
        SSH_ASKPASS: "/usr/bin/true",
        GIT_SSH_COMMAND: "ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new",
        GIT_OPTIONAL_LOCKS: "0",
      };

  return new Promise((resolvePromise) => {
    execFile(
      cmd,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env,
      },
      (err, stdout, stderr) => {
        resolvePromise({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

/** Convenience wrapper for git, returning trimmed stdout or null on failure. */
export async function git(cwd: string, args: string[], timeoutMs?: number): Promise<string | null> {
  const res = await run(cwd, "git", args, timeoutMs);
  return res.ok ? res.stdout.trim() : null;
}

/** Runs tasks with bounded concurrency so a 50-repo scan does not fork 50 git processes at once. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
