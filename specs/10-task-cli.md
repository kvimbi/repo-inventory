# TASK 10 — CLI entry point

**Goal:** `bin/inventory.ts` — the single entry point behind every npm script.

**File you create:** `bin/inventory.ts`

**Files you must not touch:** everything else.

---

## Commands

```
node bin/inventory.ts scan [--fetch]
node bin/inventory.ts report [--fetch] [--rescan]
node bin/inventory.ts serve [--port N]
node bin/inventory.ts dev [--port N]
```

`package.json` already wires these:
`scan` → `scan`, `report` → `report`, `serve` → `serve`, `dev` → `dev`.

## Resolving `baseDir`

The tool must work regardless of the caller's cwd:

```ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
```

Do not use `process.cwd()`.

## Argument parsing

Use `node:util`'s `parseArgs`. No dependency needed.

```ts
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    fetch: { type: "boolean", default: false },
    rescan: { type: "boolean", default: false },
    port: { type: "string" },
  },
});
const command = positionals[0] ?? "scan";
```

An unknown command prints the usage block and exits with code `1`.

---

## `scan`

1. Print `Scanning <root>…` to **stderr**.
2. Call `scan({ baseDir, fetch: values.fetch, onProgress })`.
3. `onProgress` writes a single rewriting line to stderr:
   `` process.stderr.write(`\r${done}/${total} ${relPath.slice(0, 60).padEnd(60)}`) ``
   then a newline when finished. Progress goes to stderr so `stdout` stays pipeable.
4. Print a summary to **stdout**:

   ```
   53 projects in 12.4s (remote state: stale)
     critical  9
     warn     14
     info     22
     ok        8
   wrote data/inventory.json
   ```

   The four counts are projects bucketed by their highest flag severity: `risk 3`
   → critical, `2` → warn, `1` → info, `0` → ok.
5. Exit `0`.

Warn on stderr when `values.fetch` is false and any project has a remote:
`note: ahead/behind is from cached refs; run with --fetch for live numbers`.

## `report`

1. `const inventory = values.rescan ? await scan({...}) : (await readInventory(baseDir)) ?? await scan({...})`
2. `const path = await writeReport(baseDir, inventory)`
3. Print `wrote <path>` to stdout. Exit `0`.

## `serve`

1. Resolve the port: `--port`, else `config.port` from `loadConfig(baseDir)`.
2. Check whether `<baseDir>/dist/index.html` exists. When it does not, print to
   stderr:
   ```
   Frontend not built. Run:  npm run build
   Starting API only.
   ```
   Do not attempt to build — that is `npm run build`'s job, and silently running a
   bundler inside a "serve" command is surprising.
3. `const address = await startServer({ baseDir, port, serveStatic: true })` — the
   server does its own `existsSync` check, so passing `true` is always correct here.
4. Print `repo-inventory → <address>` to stdout.
5. Do not exit; the server keeps the process alive.
6. Handle `SIGINT`: print a newline and `process.exit(0)`.

## `dev`

Runs the API and the Vite dev server together, so the frontend gets HMR.

1. Start the API exactly as `serve` does but with `serveStatic: false`.
2. Spawn Vite as a child process:

   ```ts
   import { spawn } from "node:child_process";

   const vite = spawn("npx", ["vite"], { cwd: baseDir, stdio: "inherit" });
   ```
3. Print `API → http://127.0.0.1:<port>` and
   `UI  → http://127.0.0.1:4748 (open this one)`.
4. On `SIGINT`, kill the Vite child then exit.
5. If the Vite child exits with a non-zero code, print its code and exit with it.

This is the only place in the codebase that spawns a process for a
non-inspection purpose, and it is not touching the user's repositories.

## Usage text

Printed for an unknown command or `--help`:

```
repo-inventory — overview of every project under a folder

  scan [--fetch]              collect facts, write data/inventory.json
  report [--fetch] [--rescan] write INVENTORY.md
  serve [--port N]            start the dashboard (needs: npm run build)
  dev [--port N]              start API + Vite dev server with HMR

--fetch contacts remotes so ahead/behind is accurate. Slower, needs credentials.
Nothing in this tool ever modifies a repository.
```

---

## Verification

```bash
cd /path/to/repo-inventory
npm run typecheck

node bin/inventory.ts nonsense; echo "exit=$?"
npm run scan
npm run report
head -20 INVENTORY.md

npm run serve &
sleep 25
curl -s localhost:4747/api/health; echo
kill %1
```

Checklist:

- [ ] `npm run typecheck` clean
- [ ] The unknown command prints the usage text and `exit=1`
- [ ] `npm run scan` shows a live progress line, then the four severity counts
- [ ] `npm run scan | cat` produces clean stdout with no progress spinner mixed in
      (proves progress went to stderr)
- [ ] `npm run report` writes `INVENTORY.md`
- [ ] `npm run serve` prints an address and `/api/health` answers
- [ ] Ctrl-C / `kill` shuts the server down without an unhandled rejection
- [ ] The `--fetch` note appears when running without `--fetch`

## Report back

The full stdout of `npm run scan`, and the first 20 lines of `INVENTORY.md`.
