import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve, sep } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { scan, readInventory, refresh, reprobeProject } from "../core/scan.ts";
import { loadRegistry } from "../core/registry.ts";
import { AnnotationStore, STATUSES } from "../core/state.ts";
import { RENDERABLE_DOC_FILES } from "../core/config.ts";
import { IDE_LAUNCHERS } from "../core/ides.ts";
import { run } from "../core/exec.ts";
import {
  OpenCodeRunner,
  OPENCODE_AVAILABLE_MODELS,
  DEFAULT_OPENCODE_MODEL,
} from "./opencodeRunner.ts";
import type { Inventory, Project, ProjectStatus, FlagSeverity } from "../core/types.ts";

const MAX_DOC_BYTES = 1_000_000;

export interface McpServerOptions {
  baseDir: string;
}

/**
 * Creates and connects the Model Context Protocol (MCP) server for repo-inventory.
 */
export async function createMcpServer(options: McpServerOptions): Promise<McpServer> {
  const mcp = new McpServer({
    name: "repo-inventory",
    version: "0.1.0",
  });

  const opencodeRunner = new OpenCodeRunner();

  // Maintain active inventory state in memory
  let current: Inventory | null = await readInventory(options.baseDir);
  if (!current || current.projects.length === 0) {
    current = await scan({ baseDir: options.baseDir });
  }

  const getInventory = async (): Promise<Inventory> => {
    if (!current || current.projects.length === 0) {
      current = await scan({ baseDir: options.baseDir });
    }
    current = await refresh(options.baseDir, current);
    return current;
  };

  const findProject = (inv: Inventory, idOrPath: string): Project | undefined => {
    const term = idOrPath.trim();
    return inv.projects.find(
      (p) => p.id === term || p.relPath === term || p.path === term || p.name === term,
    );
  };

  // --- RESOURCES ---

  mcp.registerResource(
    "all_projects",
    "inventory://projects",
    {
      description: "Full JSON listing of all projects in the inventory including facts, flags, and annotations",
      mimeType: "application/json",
    },
    async () => {
      const inv = await getInventory();
      return {
        contents: [
          {
            uri: "inventory://projects",
            mimeType: "application/json",
            text: JSON.stringify(inv, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerResource(
    "critical_flags",
    "inventory://flags/critical",
    {
      description: "Projects with critical risk severity flags (e.g. unpushed commits, unversioned directories)",
      mimeType: "application/json",
    },
    async () => {
      const inv = await getInventory();
      const criticalProjects = inv.projects.filter((p) => p.risk === 3);
      return {
        contents: [
          {
            uri: "inventory://flags/critical",
            mimeType: "application/json",
            text: JSON.stringify(criticalProjects, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerResource(
    "all_skills",
    "inventory://skills",
    {
      description: "Listing of all agentic skills across all repositories with metadata and doc references",
      mimeType: "application/json",
    },
    async () => {
      const inv = await getInventory();
      const allSkills = inv.projects.flatMap((p) =>
        (p.skills ?? []).map((s) => ({
          projectId: p.id,
          projectName: p.name,
          projectRelPath: p.relPath,
          ...s,
        })),
      );
      return {
        contents: [
          {
            uri: "inventory://skills",
            mimeType: "application/json",
            text: JSON.stringify(allSkills, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerResource(
    "project_details",
    new ResourceTemplate("inventory://project/{id}", {
      list: async () => {
        const inv = await getInventory();
        return {
          resources: inv.projects.map((p) => ({
            uri: `inventory://project/${encodeURIComponent(p.id)}`,
            name: p.annotation.alias ? `${p.annotation.alias} (${p.name})` : p.name,
            description: `Project details for ${p.relPath}`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      description: "Detailed JSON representation of a single project",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const id = typeof variables.id === "string" ? decodeURIComponent(variables.id) : "";
      const inv = await getInventory();
      const project = findProject(inv, id);
      if (!project) {
        throw new Error(`Project not found: ${id}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(project, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerResource(
    "project_doc",
    new ResourceTemplate("inventory://project/{id}/doc/{file}", {
      list: undefined,
    }),
    {
      description: "Contents of an allowlisted doc file for a project (e.g. README.md, AGENTS.md)",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const id = typeof variables.id === "string" ? decodeURIComponent(variables.id) : "";
      const file = typeof variables.file === "string" ? decodeURIComponent(variables.file) : "";

      if (!RENDERABLE_DOC_FILES.includes(file)) {
        throw new Error(`File '${file}' is not on the renderable doc allowlist`);
      }

      const inv = await getInventory();
      const project = findProject(inv, id);
      if (!project) {
        throw new Error(`Project not found: ${id}`);
      }

      const projectRoot = resolve(project.path);
      const target = resolve(projectRoot, file);
      if (target !== projectRoot && !target.startsWith(projectRoot + sep)) {
        throw new Error("File path escapes project directory");
      }

      const buffer = await readFile(target);
      const content = buffer.subarray(0, MAX_DOC_BYTES).toString("utf8");

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: file.endsWith(".md") ? "text/markdown" : "text/plain",
            text: content,
          },
        ],
      };
    },
  );

  // --- TOOLS ---

  mcp.registerTool(
    "list_projects",
    {
      description: "List projects with filtering options. Returns token-efficient summaries by default.",
      inputSchema: z.object({
        status: z.enum(["active", "stale", "obsolete", "archived", "unknown"]).optional().describe("Filter by project annotation status"),
        group: z.string().optional().describe("Filter by first path segment under root (e.g. 'tmp')"),
        stack: z.string().optional().describe("Filter by ecosystem (e.g. 'node', 'python')"),
        framework: z.string().optional().describe("Filter by framework (e.g. 'react', 'nx')"),
        project_type: z.enum(["standalone", "monorepo-root", "sub-project"]).optional().describe("Filter by project type (standalone, monorepo-root, sub-project)"),
        flag_severity: z.enum(["critical", "warn", "info", "good"]).optional().describe("Filter by highest flag severity risk"),
        favourite: z.boolean().optional().describe("Filter for favourite projects only"),
        todo: z.boolean().optional().describe("Filter for todo projects requiring action"),
        query: z.string().optional().describe("Search string matching name, alias, path, note, or remote URL"),
        limit: z.number().optional().default(50).describe("Maximum number of results to return"),
        verbose: z.boolean().optional().default(false).describe("If true, returns full Project objects instead of summaries"),
      }),
    },
    async (args) => {
      const inv = await getInventory();
      let filtered = inv.projects;

      if (args.status) {
        filtered = filtered.filter((p) => p.annotation.status === args.status);
      }
      if (args.group) {
        const targetGroup = args.group.toLowerCase();
        filtered = filtered.filter((p) => p.group.toLowerCase() === targetGroup);
      }
      if (args.stack) {
        const targetStack = args.stack.toLowerCase();
        filtered = filtered.filter((p) => p.stack?.some((s) => s.toLowerCase() === targetStack));
      }
      if (args.framework) {
        const targetFw = args.framework.toLowerCase();
        filtered = filtered.filter((p) => p.frameworks?.some((f) => f.toLowerCase() === targetFw));
      }
      if (args.project_type) {
        filtered = filtered.filter((p) => p.projectType === args.project_type);
      }
      if (args.flag_severity) {
        const targetRank = args.flag_severity === "critical" ? 3 : args.flag_severity === "warn" ? 2 : args.flag_severity === "info" ? 1 : 0;
        filtered = filtered.filter((p) => p.risk === targetRank);
      }
      if (args.favourite !== undefined) {
        filtered = filtered.filter((p) => Boolean(p.annotation.favourite) === args.favourite);
      }
      if (args.todo !== undefined) {
        filtered = filtered.filter((p) => Boolean(p.annotation.todo) === args.todo);
      }
      if (args.query) {
        const q = args.query.toLowerCase();
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.relPath.toLowerCase().includes(q) ||
            (p.annotation.alias && p.annotation.alias.toLowerCase().includes(q)) ||
            (p.annotation.note && p.annotation.note.toLowerCase().includes(q)) ||
            (p.remoteUrl && p.remoteUrl.toLowerCase().includes(q)),
        );
      }

      const count = filtered.length;
      const sliced = filtered.slice(0, args.limit);

      if (args.verbose) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ total: count, returned: sliced.length, projects: sliced }, null, 2),
            },
          ],
        };
      }

      const summaries = sliced.map((p) => ({
        id: p.id,
        name: p.annotation.alias ? `${p.annotation.alias} (${p.name})` : p.name,
        relPath: p.relPath,
        group: p.group,
        kind: p.kind,
        projectType: p.projectType,
        isMonorepo: p.isMonorepo ?? false,
        monorepoRootId: p.monorepoRootId ?? null,
        subProjectCount: p.subProjectCount ?? 0,
        isGit: p.isGit ?? false,
        branch: p.branch ?? null,
        ahead: p.ahead ?? 0,
        behind: p.behind ?? 0,
        dirtyFiles: p.dirtyFiles ?? 0,
        status: p.annotation.status,
        risk: p.risk,
        flagsCount: p.flags.length,
        stack: p.stack ?? [],
        frameworks: p.frameworks ?? [],
        alias: p.annotation.alias ?? null,
        favourite: p.annotation.favourite ?? false,
        todo: p.annotation.todo ?? false,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ total: count, returned: summaries.length, projects: summaries }, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "get_project",
    {
      description: "Retrieve complete detailed facts, flags, annotation, and doc files for a single project.",
      inputSchema: z.object({
        id: z.string().describe("Project ID, relative path, or name"),
      }),
    },
    async (args) => {
      const inv = await getInventory();
      const project = findProject(inv, args.id);
      if (!project) {
        return {
          isError: true,
          content: [{ type: "text", text: `Project not found matching identifier: ${args.id}` }],
        };
      }

      const foundDocs: string[] = [];
      for (const file of RENDERABLE_DOC_FILES) {
        try {
          const s = await stat(resolve(project.path, file));
          if (s.isFile()) foundDocs.push(file);
        } catch {
          // file not present
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ...project, availableDocs: foundDocs }, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "search_projects",
    {
      description: "Search across project facts, stack, agent tooling, git status, and notes.",
      inputSchema: z.object({
        query: z.string().describe("Search query keyword"),
      }),
    },
    async (args) => {
      const inv = await getInventory();
      const q = args.query.toLowerCase().trim();
      if (!q) {
        return {
          content: [{ type: "text", text: JSON.stringify({ query: args.query, results: [] }) }],
        };
      }

      const matches = inv.projects.filter((p) => {
        if (p.name.toLowerCase().includes(q)) return true;
        if (p.relPath.toLowerCase().includes(q)) return true;
        if (p.annotation.alias?.toLowerCase().includes(q)) return true;
        if (p.annotation.note?.toLowerCase().includes(q)) return true;
        if (p.remoteUrl?.toLowerCase().includes(q)) return true;
        if (p.branch?.toLowerCase().includes(q)) return true;
        if (p.stack?.some((s) => s.toLowerCase().includes(q))) return true;
        if (p.frameworks?.some((f) => f.toLowerCase().includes(q))) return true;
        if (p.agentTooling?.some((a) => a.toLowerCase().includes(q))) return true;
        if (p.skills?.some((s) => s.name.toLowerCase().includes(q) || (s.description && s.description.toLowerCase().includes(q)))) return true;
        if (p.flags.some((f) => f.rule.toLowerCase().includes(q) || f.label.toLowerCase().includes(q))) return true;
        return false;
      });

      const results = matches.map((p) => ({
        id: p.id,
        name: p.name,
        relPath: p.relPath,
        status: p.annotation.status,
        risk: p.risk,
        stack: p.stack,
        frameworks: p.frameworks,
        agentTooling: p.agentTooling,
        skills: p.skills,
        alias: p.annotation.alias,
        note: p.annotation.note,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ query: args.query, totalMatches: matches.length, results }, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "get_project_doc",
    {
      description: "Read the contents of an allowlisted doc file for a project (e.g. README.md, AGENTS.md, or .agents/skills/.../SKILL.md).",
      inputSchema: z.object({
        id: z.string().describe("Project ID, relative path, or name"),
        file: z.string().describe("Allowlisted doc file name (e.g. README.md, AGENTS.md, or skill markdown file)"),
      }),
    },
    async (args) => {
      const isAllowed =
        RENDERABLE_DOC_FILES.includes(args.file) ||
        /^(\.agents|\.claude)\/skills\/[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+\.md|\.md)?$/i.test(args.file);
      if (!isAllowed) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `File '${args.file}' is not on the renderable doc allowlist. Allowed files: ${RENDERABLE_DOC_FILES.join(", ")}, or agent skill docs.`,
            },
          ],
        };
      }

      const inv = await getInventory();
      const project = findProject(inv, args.id);
      if (!project) {
        return {
          isError: true,
          content: [{ type: "text", text: `Project not found: ${args.id}` }],
        };
      }

      const projectRoot = resolve(project.path);
      const target = resolve(projectRoot, args.file);
      if (target !== projectRoot && !target.startsWith(projectRoot + sep)) {
        return {
          isError: true,
          content: [{ type: "text", text: "File escapes project directory" }],
        };
      }

      try {
        const s = await stat(target);
        if (!s.isFile()) {
          return { isError: true, content: [{ type: "text", text: `Target ${args.file} is not a file` }] };
        }
        const buffer = await readFile(target);
        const truncated = buffer.byteLength > MAX_DOC_BYTES;
        const text = buffer.subarray(0, MAX_DOC_BYTES).toString("utf8");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ file: args.file, project: project.relPath, truncated, content: text }, null, 2),
            },
          ],
        };
      } catch {
        return {
          isError: true,
          content: [{ type: "text", text: `Doc file ${args.file} does not exist in project ${project.relPath}` }],
        };
      }
    },
  );

  mcp.registerTool(
    "list_skills",
    {
      description: "List all agentic skills discovered across all repositories in the inventory, optionally filtered by search keyword.",
      inputSchema: z.object({
        query: z.string().optional().describe("Optional keyword to filter skills by name, description, or repository"),
      }),
    },
    async (args) => {
      const inv = await getInventory();
      const q = args.query?.toLowerCase().trim();

      const allSkills = inv.projects.flatMap((p) =>
        (p.skills ?? []).map((s) => ({
          projectId: p.id,
          projectName: p.name,
          projectRelPath: p.relPath,
          name: s.name,
          relPath: s.relPath,
          description: s.description,
          docFile: s.docFile,
        })),
      );

      const filtered = q
        ? allSkills.filter(
            (s) =>
              s.name.toLowerCase().includes(q) ||
              (s.description && s.description.toLowerCase().includes(q)) ||
              s.projectName.toLowerCase().includes(q) ||
              s.projectRelPath.toLowerCase().includes(q),
          )
        : allSkills;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query: args.query ?? null,
                total: filtered.length,
                skills: filtered,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "get_skill",
    {
      description: "Retrieve full markdown instructions / documentation for a specific agent skill from a project.",
      inputSchema: z.object({
        id: z.string().describe("Project ID, relative path, or name"),
        skillName: z.string().describe("Name of the skill to retrieve instructions for"),
      }),
    },
    async (args) => {
      const inv = await getInventory();
      const project = findProject(inv, args.id);
      if (!project) {
        return {
          isError: true,
          content: [{ type: "text", text: `Project not found: ${args.id}` }],
        };
      }

      const skill = project.skills?.find(
        (s) =>
          s.name.toLowerCase() === args.skillName.toLowerCase() ||
          s.relPath.toLowerCase().endsWith(`/${args.skillName.toLowerCase()}`),
      );
      if (!skill) {
        const available = (project.skills ?? []).map((s) => s.name).join(", ") || "none";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Skill '${args.skillName}' not found in project '${project.name}'. Available skills: ${available}`,
            },
          ],
        };
      }

      if (!skill.docFile) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  projectId: project.id,
                  projectName: project.name,
                  skill: skill.name,
                  relPath: skill.relPath,
                  description: skill.description,
                  instructions: "No separate markdown instruction file found for this skill directory.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const projectRoot = resolve(project.path);
      const target = resolve(projectRoot, skill.docFile);
      if (target !== projectRoot && !target.startsWith(projectRoot + sep)) {
        return {
          isError: true,
          content: [{ type: "text", text: "Skill doc file escapes project directory" }],
        };
      }

      try {
        const s = await stat(target);
        if (!s.isFile()) {
          return { isError: true, content: [{ type: "text", text: `Target doc ${skill.docFile} is not a file` }] };
        }
        const buffer = await readFile(target);
        const truncated = buffer.byteLength > MAX_DOC_BYTES;
        const text = buffer.subarray(0, MAX_DOC_BYTES).toString("utf8");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  projectId: project.id,
                  projectName: project.name,
                  skill: skill.name,
                  relPath: skill.relPath,
                  docFile: skill.docFile,
                  description: skill.description,
                  truncated,
                  content: text,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to read skill doc: ${error instanceof Error ? error.message : String(error)}` }],
        };
      }
    },
  );

  mcp.registerTool(
    "scan_inventory",
    {
      description: "Trigger a full scan of all repositories in the configured root directory.",
      inputSchema: z.object({
        fetch: z.boolean().optional().default(false).describe("If true, contacts remotes to update ahead/behind counters"),
      }),
    },
    async (args) => {
      current = await scan({ baseDir: options.baseDir, fetch: args.fetch });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                scannedAt: current.scannedAt,
                durationMs: current.durationMs,
                totalProjects: current.projects.length,
                fetched: current.fetched,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "rescan_project",
    {
      description: "Re-probe facts and flags for a single project.",
      inputSchema: z.object({
        id: z.string().describe("Project ID, relative path, or name"),
        fetch: z.boolean().optional().default(false).describe("If true, fetches remotes for this project"),
      }),
    },
    async (args) => {
      const inv = await getInventory();
      const target = findProject(inv, args.id);
      if (!target) {
        return {
          isError: true,
          content: [{ type: "text", text: `Project not found: ${args.id}` }],
        };
      }

      const { inventory: updatedInventory, project: updatedProject } = await reprobeProject(
        options.baseDir,
        target.id,
        inv,
        args.fetch,
      );
      current = updatedInventory;

      if (!updatedProject) {
        return { isError: true, content: [{ type: "text", text: "Project lost during re-scan" }] };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, project: updatedProject }, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "fetch_project",
    {
      description: "Run git fetch on a single project's remote to update ahead/behind commit numbers.",
      inputSchema: z.object({
        id: z.string().describe("Project ID, relative path, or name"),
      }),
    },
    async (args) => {
      const inv = await getInventory();
      const target = findProject(inv, args.id);
      if (!target) {
        return { isError: true, content: [{ type: "text", text: `Project not found: ${args.id}` }] };
      }
      if (target.isGit !== true || target.hasRemote !== true) {
        return { isError: true, content: [{ type: "text", text: `Project ${target.relPath} has no git remote` }] };
      }

      const remoteName = target.remoteName ?? "origin";
      const result = await run(target.path, "git", ["fetch", "--prune", "--quiet", remoteName]);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `git fetch failed: ${result.stderr.trim() || "unknown error"}` }],
        };
      }

      const { inventory: updatedInventory, project: updatedProject } = await reprobeProject(
        options.baseDir,
        target.id,
        inv,
      );
      current = updatedInventory;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, project: updatedProject }, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "update_annotation",
    {
      description: "Update user-authored metadata for a project (status, note, alias, favourite, snooze).",
      inputSchema: z.object({
        id: z.string().describe("Project ID, relative path, or name"),
        status: z.enum(["active", "stale", "obsolete", "archived", "unknown"]).optional().describe("Project lifecycle status"),
        note: z.string().optional().describe("Freeform note (max 2000 chars)"),
        alias: z.string().nullable().optional().describe("Custom display name override or null to clear"),
        favourite: z.boolean().optional().describe("Toggle favourite bookmark"),
        todo: z.boolean().optional().describe("Toggle todo flag requiring action"),
        snoozedUntil: z.string().nullable().optional().describe("ISO date string until which non-critical flags are suppressed, or null"),
        suppressedFlags: z.array(z.string()).optional().describe("Array of rule names to suppress for this project"),
      }),
    },
    async (args) => {
      const inv = await getInventory();
      const target = findProject(inv, args.id);
      if (!target) {
        return { isError: true, content: [{ type: "text", text: `Project not found: ${args.id}` }] };
      }

      const store = await AnnotationStore.open(options.baseDir);
      const patch: {
        status?: ProjectStatus;
        note?: string;
        snoozedUntil?: string | null;
        favourite?: boolean;
        todo?: boolean;
        alias?: string | null;
        suppressedFlags?: string[];
      } = {};

      if (args.status !== undefined) patch.status = args.status as ProjectStatus;
      if (args.note !== undefined) patch.note = args.note;
      if (args.alias !== undefined) patch.alias = args.alias ? args.alias.trim() : null;
      if (args.favourite !== undefined) patch.favourite = args.favourite;
      if (args.todo !== undefined) patch.todo = args.todo;
      if (args.snoozedUntil !== undefined) {
        patch.snoozedUntil = args.snoozedUntil === null ? null : new Date(args.snoozedUntil).toISOString();
      }
      if (args.suppressedFlags !== undefined) patch.suppressedFlags = args.suppressedFlags;

      const updatedAnnotation = await store.update(target.id, patch);
      current = await refresh(options.baseDir, inv);
      const updatedProject = current.projects.find((p) => p.id === target.id);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ annotation: updatedAnnotation, project: updatedProject }, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "open_in_ide",
    {
      description: "Launch a project in an IDE or editor CLI launcher (vscode, cursor, zed, finder, terminal, etc.).",
      inputSchema: z.object({
        id: z.string().describe("Project ID, relative path, or name"),
        ide: z.string().describe("IDE launcher key (e.g. 'vscode', 'cursor', 'zed', 'finder', 'terminal')"),
      }),
    },
    async (args) => {
      const launcher = IDE_LAUNCHERS.find((l) => l.id === args.ide);
      if (!launcher) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unknown IDE: '${args.ide}'. Available: ${IDE_LAUNCHERS.map((l) => l.id).join(", ")}`,
            },
          ],
        };
      }

      const inv = await getInventory();
      const target = findProject(inv, args.id);
      if (!target) {
        return { isError: true, content: [{ type: "text", text: `Project not found: ${args.id}` }] };
      }

      const res = await run(target.path, launcher.command, [target.path]);
      if (!res.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Could not launch ${launcher.label} (\`${launcher.command}\`): ${res.stderr.trim() || "failed"}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, launched: launcher.label, path: target.path }),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "generate_action_script",
    {
      description: "Generate defensive bash script for inventory actions (e.g. clean-disposable).",
      inputSchema: z.object({
        action: z.string().describe("Action name (e.g. 'clean-disposable')"),
        ids: z.array(z.string()).describe("List of project IDs or paths to process"),
      }),
    },
    async (args) => {
      const registry = await loadRegistry(options.baseDir);
      const actionObj = registry.actions.find((a) => a.name === args.action);
      if (!actionObj) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unknown action: '${args.action}'. Available: ${registry.actions.map((a) => a.name).join(", ")}`,
            },
          ],
        };
      }

      const inv = await getInventory();
      const included: string[] = [];
      const skipped: string[] = [];
      const scriptLines: string[] = [];

      for (const queryId of args.ids) {
        const project = findProject(inv, queryId);
        if (!project || !actionObj.appliesTo(project)) {
          skipped.push(project?.relPath ?? queryId);
          continue;
        }
        included.push(project.relPath);
        scriptLines.push(...actionObj.script(project, inv.root));
      }

      const script = `#!/usr/bin/env bash
# Generated by repo-inventory MCP on ${new Date().toISOString()}
# Action: ${actionObj.label} — ${actionObj.description}
# Projects: ${included.length}
set -euo pipefail

ROOT="${inv.root}"

${scriptLines.join("\n")}
echo "done"
`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ script, included, skipped }, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "run_opencode_agent",
    {
      description: "Spawn an OpenCode AI agent in a sandboxed, strictly read-only mode to perform analysis, planning, or queries using configured tools/MCPs without modifying local files.",
      inputSchema: z.object({
        id: z.string().describe("Target project ID, relative path, or name"),
        instruction: z.string().describe("The objective, question, or research task for the OpenCode agent"),
        model: z
          .enum(OPENCODE_AVAILABLE_MODELS)
          .optional()
          .default(DEFAULT_OPENCODE_MODEL)
          .describe(`AI model for the OpenCode agent (default: '${DEFAULT_OPENCODE_MODEL}')`),
        timeout_seconds: z.number().optional().default(300).describe("Maximum runtime in seconds before timeout (default: 300)"),
      }),
    },
    async (args) => {
      const inv = await getInventory();
      const project = findProject(inv, args.id);
      if (!project) {
        return {
          isError: true,
          content: [{ type: "text", text: `Project not found: ${args.id}` }],
        };
      }

      if (!opencodeRunner.isOpenCodeInstalled()) {
        return {
          isError: true,
          content: [{ type: "text", text: "OpenCode CLI ('opencode') is not installed or not available on PATH" }],
        };
      }

      const result = await opencodeRunner.runAgent({
        project: { id: project.id, name: project.name, path: project.path },
        instruction: args.instruction,
        model: args.model,
        timeoutSeconds: args.timeout_seconds,
      });

      return {
        isError: result.status === "failed" || result.status === "timed_out",
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "start_opencode_task",
    {
      description: "Start an asynchronous, long-running OpenCode AI agent task in sandboxed read-only mode (returns a taskId immediately for polling status/results).",
      inputSchema: z.object({
        id: z.string().describe("Target project ID, relative path, or name"),
        instruction: z.string().describe("The objective, question, or research task for the OpenCode agent"),
        model: z
          .enum(OPENCODE_AVAILABLE_MODELS)
          .optional()
          .default(DEFAULT_OPENCODE_MODEL)
          .describe(`AI model for the OpenCode agent (default: '${DEFAULT_OPENCODE_MODEL}')`),
        timeout_seconds: z.number().optional().default(300).describe("Maximum runtime in seconds before timeout (default: 300)"),
      }),
    },
    async (args) => {
      const inv = await getInventory();
      const project = findProject(inv, args.id);
      if (!project) {
        return {
          isError: true,
          content: [{ type: "text", text: `Project not found: ${args.id}` }],
        };
      }

      if (!opencodeRunner.isOpenCodeInstalled()) {
        return {
          isError: true,
          content: [{ type: "text", text: "OpenCode CLI ('opencode') is not installed or not available on PATH" }],
        };
      }

      const taskId = opencodeRunner.startTask({
        project: { id: project.id, name: project.name, path: project.path },
        instruction: args.instruction,
        model: args.model,
        timeoutSeconds: args.timeout_seconds,
      });

      const snapshot = opencodeRunner.getTask(taskId);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                taskId,
                status: snapshot?.status ?? "working",
                startedAt: snapshot?.startedAt,
                projectId: project.id,
                projectName: project.name,
                sandboxed: true,
                message: "OpenCode agent started in background. Check status or fetch final output with get_opencode_task.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "get_opencode_task",
    {
      description: "Get the status, interim output, tool usage, or final result of a background OpenCode agent task.",
      inputSchema: z.object({
        task_id: z.string().describe("The task ID returned from start_opencode_task"),
      }),
    },
    async (args) => {
      const task = opencodeRunner.getTask(args.task_id);
      if (!task) {
        return {
          isError: true,
          content: [{ type: "text", text: `Task not found: ${args.task_id}` }],
        };
      }

      return {
        isError: task.status === "failed" || task.status === "timed_out",
        content: [
          {
            type: "text",
            text: JSON.stringify(task, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "cancel_opencode_task",
    {
      description: "Cancel/stop an in-progress background OpenCode agent task.",
      inputSchema: z.object({
        task_id: z.string().describe("The task ID returned from start_opencode_task"),
      }),
    },
    async (args) => {
      const task = opencodeRunner.cancelTask(args.task_id);
      if (!task) {
        return {
          isError: true,
          content: [{ type: "text", text: `Task not found: ${args.task_id}` }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(task, null, 2),
          },
        ],
      };
    },
  );

  // --- PROMPTS ---

  mcp.registerPrompt(
    "audit_unpushed_work",
    {
      description: "Audit repositories with unpushed commits, uncommitted work, or local-only branches",
    },
    async () => {
      const inv = await getInventory();
      const unpushed = inv.projects.filter((p) => (p.ahead ?? 0) > 0 || (p.localOnlyBranches?.length ?? 0) > 0);
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Analyze the following repositories with unpushed commits or local branches:\n${JSON.stringify(
                unpushed.map((p) => ({
                  relPath: p.relPath,
                  branch: p.branch,
                  ahead: p.ahead,
                  localOnlyBranches: p.localOnlyBranches,
                  flags: p.flags,
                })),
                null,
                2,
              )}`,
            },
          },
        ],
      };
    },
  );

  mcp.registerPrompt(
    "tech_stack_summary",
    {
      description: "Summarize ecosystem and framework distributions across all projects in the workspace",
    },
    async () => {
      const inv = await getInventory();
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Summarize the tech stacks across the inventory of ${inv.projects.length} repositories:\n${JSON.stringify(
                inv.projects.map((p) => ({
                  name: p.name,
                  group: p.group,
                  stack: p.stack,
                  frameworks: p.frameworks,
                  isMonorepo: p.isMonorepo,
                })),
                null,
                2,
              )}`,
            },
          },
        ],
      };
    },
  );

  mcp.registerPrompt(
    "cleanup_disposable_space",
    {
      description: "Find repositories consuming large amounts of disposable space (node_modules, target, etc.)",
    },
    async () => {
      const inv = await getInventory();
      const highDisposable = inv.projects
        .filter((p) => (p.disposableBytes ?? 0) > 100_000_000)
        .sort((a, b) => (b.disposableBytes ?? 0) - (a.disposableBytes ?? 0));

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Identify candidates for disposable build folder cleanup:\n${JSON.stringify(
                highDisposable.map((p) => ({
                  relPath: p.relPath,
                  disposableBytes: p.disposableBytes,
                  disposableMb: Math.round((p.disposableBytes ?? 0) / 1024 / 1024),
                  status: p.annotation.status,
                })),
                null,
                2,
              )}`,
            },
          },
        ],
      };
    },
  );

  return mcp;
}

/**
 * Starts the MCP stdio transport server.
 */
export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const mcp = await createMcpServer(options);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}
