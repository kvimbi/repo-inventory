#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAugmentedEnv } from "../core/env.ts";
import { resolveBaseDir } from "../core/config.ts";
import { startMcpServer } from "../server/mcp.ts";

ensureAugmentedEnv();

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseDir = resolveBaseDir(repoRoot);

startMcpServer({ baseDir }).catch((error) => {
  console.error("Fatal MCP server error:", error);
  process.exit(1);
});
