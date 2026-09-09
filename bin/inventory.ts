#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { ensureAugmentedEnv } from "../core/env.ts";
import { scan, readInventory } from "../core/scan.ts";
import { writeReport } from "../core/report.ts";
import { loadConfig } from "../core/config.ts";
import { startServer } from "../server/index.ts";
import type { ScanProgress } from "../core/types.ts";

ensureAugmentedEnv();

const baseDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    fetch: { type: "boolean", default: false },
    rescan: { type: "boolean", default: false },
    port: { type: "string" },
  },
});

const command = positionals[0] ?? "scan";

const USAGE = `repo-inventory — overview of every project under a folder

  scan [--fetch]              collect facts, write data/inventory.json
  report [--fetch] [--rescan] write INVENTORY.md
  serve [--port N]            start the dashboard (needs: npm run build)
  dev [--port N]              start API + Vite dev server with HMR
  app                         start standalone Electron desktop app
  app-dev                     start Electron app with Vite live reload

--fetch contacts remotes so ahead/behind is accurate. Slower, needs credentials.
Nothing in this tool ever modifies a repository.
`;

function reportCliProgress(progress: ScanProgress) {
  if (progress.phase === "probing" && progress.done !== undefined && progress.total !== undefined) {
    const current = progress.current ?? "";
    process.stderr.write(`\r${progress.done}/${progress.total} ${current.slice(0, 60).padEnd(60)}`);
  } else if (progress.message && progress.phase === "discovering") {
    process.stderr.write(`\r${progress.message.slice(0, 60).padEnd(60)}`);
  }
}

async function cmdScan() {
  const config = await loadConfig(baseDir);
  console.error(`Scanning ${config.root}…`);

  const inventory = await scan({
    baseDir,
    fetch: values.fetch,
    onProgress: reportCliProgress,
  });

  process.stderr.write("\n");

  // Count by severity
  let critical = 0, warn = 0, info = 0, ok = 0;
  for (const p of inventory.projects) {
    if (p.risk === 3) critical++;
    else if (p.risk === 2) warn++;
    else if (p.risk === 1) info++;
    else ok++;
  }

  const remoteState = inventory.fetched ? "fresh" : "stale";
  console.log(`${inventory.projects.length} projects in ${(inventory.durationMs / 1000).toFixed(1)}s (remote state: ${remoteState})`);
  console.log(`  critical  ${critical}`);
  console.log(`  warn     ${warn}`);
  console.log(`  info     ${info}`);
  console.log(`  ok        ${ok}`);
  console.log(`wrote data/inventory.json`);

  // Warn about stale refs if any project has a remote and we didn't fetch
  if (!values.fetch) {
    const hasRemote = inventory.projects.some((p) => p.hasRemote);
    if (hasRemote) {
      console.error("note: ahead/behind is from cached refs; run with --fetch for live numbers");
    }
  }
}

async function cmdReport() {
  let inventory;
  if (values.rescan) {
    const config = await loadConfig(baseDir);
    console.error(`Scanning ${config.root}…`);
    inventory = await scan({
      baseDir,
      fetch: values.fetch,
      onProgress: reportCliProgress,
    });
    process.stderr.write("\n");
  } else {
    inventory = await readInventory(baseDir);
    if (!inventory || inventory.projects.length === 0) {
      const config = await loadConfig(baseDir);
      console.error(`Scanning ${config.root}…`);
      inventory = await scan({
        baseDir,
        fetch: values.fetch,
        onProgress: reportCliProgress,
      });
      process.stderr.write("\n");
    }
  }

  const path = await writeReport(baseDir, inventory);
  console.log(`wrote ${path}`);
}

async function cmdServe() {
  const config = await loadConfig(baseDir);
  const port = values.port ? Number(values.port) : config.port;

  const hasFrontend = existsSync(resolve(baseDir, "dist/index.html"));
  if (!hasFrontend) {
    console.error("Frontend not built. Run:  npm run build");
    console.error("Starting API only.");
  }

  const address = await startServer({ baseDir, port, serveStatic: true });
  console.log(`repo-inventory → ${address}`);

  process.on("SIGINT", () => {
    console.log("");
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

async function cmdDev() {
  const config = await loadConfig(baseDir);
  const port = values.port ? Number(values.port) : config.port;

  const address = await startServer({ baseDir, port, serveStatic: false });
  console.log(`API → ${address}`);
  console.log("UI  → http://127.0.0.1:4748 (open this one)");

  const vite = spawn("npx", ["vite"], { cwd: baseDir, stdio: "inherit" });

  process.on("SIGINT", () => {
    vite.kill("SIGINT");
  });

  vite.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`Vite exited with code ${code}`);
      process.exit(code);
    }
    process.exit(0);
  });
}

async function cmdAppDev() {
  if (!existsSync(resolve(baseDir, "build/icon.png"))) {
    console.log("Generating app icons…");
    spawnSync("node", ["scripts/generate-icons.js"], { cwd: baseDir, stdio: "inherit" });
  }

  console.log("Building Electron main process…");
  const buildResult = spawnSync("npx", ["vite", "build", "--config", "vite.electron.config.ts"], {
    cwd: baseDir,
    stdio: "inherit",
  });
  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }

  console.log("Starting Vite dev server…");
  const vite = spawn("npx", ["vite"], { cwd: baseDir, stdio: "inherit" });

  // Give Vite dev server a short head start
  await new Promise((resolve) => setTimeout(resolve, 800));

  console.log("Launching Electron app…");
  const electron = spawn("npx", ["electron", "."], {
    cwd: baseDir,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development", VITE_DEV_SERVER_URL: "http://127.0.0.1:4748" },
  });

  const cleanup = () => {
    vite.kill("SIGINT");
    electron.kill("SIGINT");
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  electron.on("exit", (code) => {
    vite.kill("SIGINT");
    process.exit(code ?? 0);
  });
}

async function cmdApp() {
  const hasFrontend = existsSync(resolve(baseDir, "dist/index.html"));
  const hasElectron = existsSync(resolve(baseDir, "dist-electron/main.js"));
  const hasIcons = existsSync(resolve(baseDir, "build/icon.png"));

  if (!hasFrontend || !hasElectron || !hasIcons) {
    console.log("Building app bundles…");
    const buildRes = spawnSync("npm", ["run", "build"], { cwd: baseDir, stdio: "inherit" });
    if (buildRes.status !== 0) {
      process.exit(buildRes.status ?? 1);
    }
  }

  const electron = spawn("npx", ["electron", "."], {
    cwd: baseDir,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });

  process.on("SIGINT", () => electron.kill("SIGINT"));
  electron.on("exit", (code) => process.exit(code ?? 0));
}

switch (command) {
  case "scan":
    await cmdScan();
    break;
  case "report":
    await cmdReport();
    break;
  case "serve":
    await cmdServe();
    break;
  case "dev":
    await cmdDev();
    break;
  case "app":
    await cmdApp();
    break;
  case "app-dev":
  case "app:dev":
    await cmdAppDev();
    break;
  case "--help":
  case "-h":
    console.log(USAGE);
    process.exit(0);
    break;
  default:
    console.log(USAGE);
    process.exit(1);
}
