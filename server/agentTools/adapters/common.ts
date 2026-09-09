import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import type {
  AgentToolId,
  ConfigurationReference,
  GlobalResource,
  McpServerDeclaration,
  ToolCapabilityResult,
} from "../../../core/types.ts";
import { MAX_MCP_SERVERS, MAX_RESOURCE_ITEMS } from "../bounds.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { safeParseJsonc } from "../jsonc.ts";
import { safeParseToml } from "../toml.ts";

const CANDIDATE_DOC_NAMES = ["SKILL.md", "skill.md", "README.md", "readme.md"] as const;
const MAX_HEADER_BYTES = 4096;

export function expandHome(filePath: string, home?: string): string {
  const h = home ?? homedir();
  if (filePath === "~") return h;
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return resolve(h, filePath.slice(2));
  }
  return filePath;
}

export function isInsideRoots(targetPath: string, roots: string[]): boolean {
  for (const root of roots) {
    if (targetPath === root || targetPath.startsWith(root.endsWith("/") ? root : `${root}/`)) {
      return true;
    }
  }
  return false;
}

async function tryReadHeader(filePath: string): Promise<string | null> {
  try {
    const buf = await readFile(filePath);
    return buf.subarray(0, MAX_HEADER_BYTES).toString("utf8");
  } catch {
    return null;
  }
}

export async function scanSkillsFromDirectories(
  toolId: AgentToolId,
  skillDirs: string[],
  roots: string[],
): Promise<ToolCapabilityResult<GlobalResource>> {
  const items: GlobalResource[] = [];
  const seenCanonicalIds = new Set<string>();

  // Canonicalize root paths for origin detection
  const canonicalRoots: string[] = [];
  for (const r of roots) {
    try {
      if (existsSync(r)) {
        canonicalRoots.push(await realpath(r));
      } else {
        canonicalRoots.push(r);
      }
    } catch {
      canonicalRoots.push(r);
    }
  }

  for (const skillDir of skillDirs) {
    if (items.length >= MAX_RESOURCE_ITEMS) break;

    try {
      const dirStat = await stat(skillDir);
      if (!dirStat.isDirectory()) continue;
    } catch {
      continue;
    }

    let entries;
    try {
      entries = await readdir(skillDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (items.length >= MAX_RESOURCE_ITEMS) break;
      if (entry.name.startsWith(".")) continue;

      const fullEntryPath = resolve(skillDir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const st = await stat(fullEntryPath);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }

      if (isDir) {
        let docPath = fullEntryPath;
        let docContent: string | null = null;

        for (const cand of [...CANDIDATE_DOC_NAMES, `${entry.name}.md`]) {
          const candPath = resolve(fullEntryPath, cand);
          const content = await tryReadHeader(candPath);
          if (content !== null) {
            docPath = candPath;
            docContent = content;
            break;
          }
        }

        let canonicalId: string;
        try {
          canonicalId = await realpath(docPath);
        } catch {
          canonicalId = docPath;
        }

        if (seenCanonicalIds.has(canonicalId)) continue;
        seenCanonicalIds.add(canonicalId);

        const meta = docContent
          ? parseFrontmatter(docContent)
          : { name: entry.name, description: undefined };

        const origin = isInsideRoots(canonicalId, canonicalRoots) ? "user" : "shared";

        items.push({
          id: `skill-${toolId}-${items.length + 1}`,
          toolId,
          kind: "skill",
          name: meta.name || entry.name,
          description: meta.description,
          path: docPath,
          canonicalId,
          origin,
          activation: "enabled",
        });
      } else if (isFile && entry.name.endsWith(".md") && !entry.name.toLowerCase().startsWith("readme")) {
        let canonicalId: string;
        try {
          canonicalId = await realpath(fullEntryPath);
        } catch {
          canonicalId = fullEntryPath;
        }

        if (seenCanonicalIds.has(canonicalId)) continue;
        seenCanonicalIds.add(canonicalId);

        const fallbackName = entry.name.slice(0, -3);
        const docContent = await tryReadHeader(fullEntryPath);
        const meta = docContent
          ? parseFrontmatter(docContent)
          : { name: fallbackName, description: undefined };

        const origin = isInsideRoots(canonicalId, canonicalRoots) ? "user" : "shared";

        items.push({
          id: `skill-${toolId}-${items.length + 1}`,
          toolId,
          kind: "skill",
          name: meta.name || fallbackName,
          description: meta.description,
          path: fullEntryPath,
          canonicalId,
          origin,
          activation: "enabled",
        });
      }
    }
  }

  return {
    state: "ready",
    items,
    ...(items.length >= MAX_RESOURCE_ITEMS ? { truncated: true } : {}),
  };
}

export async function scanInstructionsFromCandidates(
  toolId: AgentToolId,
  candidates: string[],
  roots: string[],
): Promise<ToolCapabilityResult<GlobalResource>> {
  const items: GlobalResource[] = [];
  const seenCanonicalIds = new Set<string>();

  const canonicalRoots: string[] = [];
  for (const r of roots) {
    try {
      if (existsSync(r)) {
        canonicalRoots.push(await realpath(r));
      } else {
        canonicalRoots.push(r);
      }
    } catch {
      canonicalRoots.push(r);
    }
  }

  for (const candidate of candidates) {
    if (items.length >= MAX_RESOURCE_ITEMS) break;

    try {
      const st = await stat(candidate);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }

    let canonicalId: string;
    try {
      canonicalId = await realpath(candidate);
    } catch {
      canonicalId = candidate;
    }

    if (seenCanonicalIds.has(canonicalId)) continue;
    seenCanonicalIds.add(canonicalId);

    const docContent = await tryReadHeader(candidate);
    const fallbackName = basename(candidate);
    const meta = docContent
      ? parseFrontmatter(docContent)
      : { name: fallbackName, description: undefined };

    const origin = isInsideRoots(canonicalId, canonicalRoots) ? "user" : "shared";

    items.push({
      id: `instruction-${toolId}-${items.length + 1}`,
      toolId,
      kind: "instruction",
      name: meta.name || fallbackName,
      description: meta.description,
      path: candidate,
      canonicalId,
      origin,
      activation: "enabled",
    });
  }

  return {
    state: "ready",
    items,
  };
}

export async function scanConfigurationsFromCandidates(
  toolId: AgentToolId,
  candidates: string[],
): Promise<ConfigurationReference[]> {
  const configs: ConfigurationReference[] = [];

  for (let idx = 0; idx < candidates.length; idx++) {
    const fullPath = candidates[idx];
    let exists = false;
    let sizeBytes: number | undefined;
    let lastModifiedAt: string | undefined;
    let canonicalPath = fullPath;

    try {
      if (existsSync(fullPath)) {
        const st = statSync(fullPath);
        if (st.isFile()) {
          exists = true;
          sizeBytes = st.size;
          lastModifiedAt = st.mtime.toISOString();
          canonicalPath = await realpath(fullPath);
        }
      }
    } catch {
      // Configuration file read error
    }

    configs.push({
      id: `cfg-${toolId}-${idx + 1}`,
      toolId,
      label: basename(fullPath),
      path: fullPath,
      canonicalPath,
      exists,
      sizeBytes,
      lastModifiedAt,
    });
  }

  return configs;
}

function inferTransport(serverObj: Record<string, unknown>): "stdio" | "sse" | "http" | "unknown" {
  const type = typeof serverObj.type === "string" ? serverObj.type.toLowerCase() : "";
  const transport = typeof serverObj.transport === "string" ? serverObj.transport.toLowerCase() : "";

  if (type === "stdio" || transport === "stdio" || ("command" in serverObj && typeof serverObj.command === "string")) {
    return "stdio";
  }
  if (type === "sse" || transport === "sse") {
    return "sse";
  }
  if (type === "http" || transport === "http") {
    return "http";
  }
  if ("url" in serverObj && typeof serverObj.url === "string") {
    const urlLower = serverObj.url.toLowerCase();
    if (urlLower.includes("sse") || urlLower.startsWith("sse://")) {
      return "sse";
    }
    return "http";
  }
  return "unknown";
}

function inferState(serverObj: Record<string, unknown>): "enabled" | "disabled" | "unknown" {
  if (serverObj.enabled === false || serverObj.disabled === true || serverObj.state === "disabled") {
    return "disabled";
  }
  if (serverObj.state === "unknown") {
    return "unknown";
  }
  return "enabled";
}

export function parseMcpFromTomlConfig(
  configRef: ConfigurationReference,
  content: string,
): McpServerDeclaration[] {
  const parsed = safeParseToml(content);
  if (!parsed.ok || typeof parsed.data !== "object" || parsed.data === null || Array.isArray(parsed.data)) {
    return [];
  }

  const root = parsed.data;
  const mcpServers = (root.mcp_servers ?? root.mcpServers) as Record<string, unknown> | undefined;
  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    return [];
  }

  const declarations: McpServerDeclaration[] = [];
  for (const [name, val] of Object.entries(mcpServers)) {
    if (typeof val !== "object" || val === null || Array.isArray(val)) continue;

    const serverObj = val as Record<string, unknown>;
    const transport = inferTransport(serverObj);
    const state = inferState(serverObj);

    declarations.push({
      id: `mcp-${configRef.id}-${name}`,
      toolId: configRef.toolId,
      name,
      transport,
      state,
      configRefId: configRef.id,
      sourcePath: configRef.path,
    });
  }

  return declarations;
}

export function parseMcpFromJsoncConfig(
  configRef: ConfigurationReference,
  content: string,
): McpServerDeclaration[] {
  const parsed = safeParseJsonc(content);
  if (!parsed.ok || typeof parsed.data !== "object" || parsed.data === null || Array.isArray(parsed.data)) {
    return [];
  }

  const root = parsed.data as Record<string, unknown>;
  const serverTables: Record<string, unknown>[] = [];

  if (root.mcpServers && typeof root.mcpServers === "object" && !Array.isArray(root.mcpServers)) {
    serverTables.push(root.mcpServers as Record<string, unknown>);
  }

  if (root.mcp && typeof root.mcp === "object" && !Array.isArray(root.mcp)) {
    const mcpObj = root.mcp as Record<string, unknown>;
    if (mcpObj.servers && typeof mcpObj.servers === "object" && !Array.isArray(mcpObj.servers)) {
      serverTables.push(mcpObj.servers as Record<string, unknown>);
    } else {
      serverTables.push(mcpObj);
    }
  }

  const declarations: McpServerDeclaration[] = [];
  const seenNames = new Set<string>();

  for (const table of serverTables) {
    for (const [name, val] of Object.entries(table)) {
      if (typeof val !== "object" || val === null || Array.isArray(val)) continue;
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      const serverObj = val as Record<string, unknown>;
      const transport = inferTransport(serverObj);
      const state = inferState(serverObj);

      declarations.push({
        id: `mcp-${configRef.id}-${name}`,
        toolId: configRef.toolId,
        name,
        transport,
        state,
        configRefId: configRef.id,
        sourcePath: configRef.path,
      });
    }
  }

  return declarations;
}

export function flagDuplicatesAndConflicts(
  declarations: McpServerDeclaration[],
): McpServerDeclaration[] {
  const nameGroups = new Map<string, McpServerDeclaration[]>();
  for (const decl of declarations) {
    const list = nameGroups.get(decl.name) ?? [];
    list.push(decl);
    nameGroups.set(decl.name, list);
  }

  return declarations.map((decl) => {
    const group = nameGroups.get(decl.name) ?? [];
    if (group.length >= 2) {
      const first = group[0];
      const hasConflict = group.some(
        (other) => other.transport !== first.transport || other.state !== first.state,
      );
      return {
        ...decl,
        duplicate: true,
        conflict: hasConflict,
      };
    }
    return {
      ...decl,
      duplicate: false,
      conflict: false,
    };
  });
}

export async function discoverMcpServersFromConfigs(
  toolId: AgentToolId,
  configs: ConfigurationReference[],
  format: "toml" | "jsonc",
): Promise<ToolCapabilityResult<McpServerDeclaration>> {
  const allDeclarations: McpServerDeclaration[] = [];
  const errors: string[] = [];

  for (const configRef of configs) {
    if (!configRef.exists) continue;

    const filePath = configRef.canonicalPath || configRef.path;
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to read ${configRef.label}: ${msg}`);
      continue;
    }

    if (format === "toml") {
      const parsed = safeParseToml(content);
      if (!parsed.ok) {
        errors.push(`Failed to parse ${configRef.label}: ${parsed.error}`);
        continue;
      }
      const decls = parseMcpFromTomlConfig(configRef, content);
      allDeclarations.push(...decls);
    } else {
      const parsed = safeParseJsonc(content);
      if (!parsed.ok) {
        errors.push(`Failed to parse ${configRef.label}: ${parsed.error}`);
        continue;
      }
      const decls = parseMcpFromJsoncConfig(configRef, content);
      allDeclarations.push(...decls);
    }
  }

  if (allDeclarations.length === 0 && errors.length > 0) {
    return {
      state: "error",
      items: [],
      reason: errors.join("\n"),
    };
  }

  const flagged = flagDuplicatesAndConflicts(allDeclarations);
  const truncated = flagged.length > MAX_MCP_SERVERS;
  const items = flagged.slice(0, MAX_MCP_SERVERS);

  return {
    state: "ready",
    items,
    ...(truncated ? { truncated: true } : {}),
    ...(errors.length > 0 ? { reason: errors.join("\n") } : {}),
  };
}

