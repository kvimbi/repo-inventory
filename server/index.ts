import Fastify, { type FastifyInstance } from "fastify";
import staticPlugin from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { ensureAugmentedEnv } from "../core/env.ts";
import { AGENT_TOOL_IDS, type AgentToolId, type Inventory } from "../core/types.ts";
import { parseAndValidateAnnotationBody, parseAndValidateBatchAnnotationBody } from "./validators.ts";
import { parseChatRequest } from "./chat.ts";
import { InventoryService } from "./service.ts";
import { AgentToolsCatalog } from "./agentTools/catalog.ts";
import { AgentToolsService } from "./agentTools/service.ts";

ensureAugmentedEnv();

export interface ServerOptions {
  baseDir: string;
  port: number;
  serveStatic: boolean;
}

export interface CreateAppOptions {
  baseDir?: string;
  serveStatic?: boolean;
  inventoryService?: InventoryService;
  agentToolsService?: AgentToolsService;
}

export async function createApp(options: CreateAppOptions = {}): Promise<{
  app: FastifyInstance;
  service: InventoryService;
  agentToolsService: AgentToolsService;
}> {
  const baseDir = options.baseDir ?? process.cwd();
  const app = Fastify({ logger: { level: "warn" } });
  const service = options.inventoryService ?? new InventoryService(baseDir);
  const agentToolsService =
    options.agentToolsService ??
    new AgentToolsService(
      new AgentToolsCatalog(
        undefined,
        undefined,
        async () => {
          try {
            const inv = await service.getInventory();
            return inv.projects.map((p) => ({ id: p.id, name: p.name, path: p.path }));
          } catch {
            return [];
          }
        }
      )
    );

  // Initialize current inventory (isolated so agent tools can run even if inventory fails)
  try {
    await service.getInventory();
  } catch {
    // Inventory initialization failure is tolerated
  }

  // Static file serving setup
  const indexPath = resolve(baseDir, "dist/index.html");
  const hasFrontend = Boolean(options.serveStatic) && existsSync(indexPath);

  if (hasFrontend) {
    await app.register(staticPlugin, {
      root: resolve(baseDir, "dist"),
      prefix: "/",
    });
  } else if (options.serveStatic) {
    app.log.warn("dist/ not built — run: npm run build");
  }

  // GET /api/health
  app.get("/api/health", async () => {
    return service.getHealth();
  });

  // GET /api/agent-tools
  app.get("/api/agent-tools", async () => {
    const tools = await agentToolsService.listTools();
    return { tools };
  });

  // POST /api/agent-tools/refresh
  app.post("/api/agent-tools/refresh", async () => {
    const tools = await agentToolsService.refresh();
    return { tools };
  });

  // GET /api/agent-tools/:id
  app.get("/api/agent-tools/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!AGENT_TOOL_IDS.includes(id as AgentToolId)) {
      return reply.code(400).send({ error: `Invalid agent tool id: ${id}` });
    }
    const details = await agentToolsService.getToolDetails(id as AgentToolId);
    if (!details) {
      return reply.code(404).send({ error: `Agent tool not found: ${id}` });
    }
    return details;
  });

  // GET /api/agent-tools/resources/preview
  app.get("/api/agent-tools/resources/preview", async (request, reply) => {
    const { ref } = request.query as { ref?: string };
    if (!ref) {
      return reply.code(400).send({ error: "Missing required query parameter: ref" });
    }
    try {
      const preview = await agentToolsService.readResource(ref);
      return preview;
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/agent-tools/config/open
  app.post("/api/agent-tools/config/open", async (request, reply) => {
    const body = (request.body ?? {}) as { ref?: string; action?: "editor" | "reveal"; ide?: string };
    if (!body.ref || (body.action !== "editor" && body.action !== "reveal")) {
      return reply.code(400).send({ error: "Invalid request: ref and valid action ('editor' | 'reveal') required" });
    }
    const result = await agentToolsService.openConfiguration(body.ref, body.action, body.ide);
    return result;
  });

  // GET /api/agent-tools/sessions/:id/transcript
  app.get("/api/agent-tools/sessions/:id/transcript", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { cursor } = request.query as { cursor?: string };
    if (!id) {
      return reply.code(400).send({ error: "Missing session id" });
    }
    try {
      const transcript = await agentToolsService.readSessionTranscript(id, cursor);
      return transcript;
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/config
  app.get("/api/config", async () => {
    return service.getConfig();
  });

  // POST /api/config
  app.post("/api/config", async (request, reply) => {
    try {
      const updates = request.body as Parameters<typeof service.saveConfig>[0];
      return await service.saveConfig(updates ?? {});
    } catch (error) {
      app.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /api/chat/agents
  app.get("/api/chat/agents", async () => ({ agents: service.getCodingAgents() }));

  // POST /api/chat
  app.post("/api/chat", async (request, reply) => {
    const parsed = parseChatRequest(request.body);
    if (!parsed.data) {
      return reply.code(400).send({ error: parsed.error });
    }

    const controller = new AbortController();
    request.raw.on("aborted", () => controller.abort());
    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    });
    const emit = (event: string, payload: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      await service.streamChat(parsed.data, (event) => emit(event.type, event), controller.signal);
      emit("done", { ok: true });
    } catch (error) {
      emit("error", { text: error instanceof Error ? error.message : String(error) });
    } finally {
      reply.raw.end();
    }
  });

  // POST /api/chat/runs
  app.post("/api/chat/runs", async (request, reply) => {
    const body = request.body as { projectId?: unknown; agent?: unknown; prompt?: unknown };
    if (typeof body.projectId !== "string" || typeof body.agent !== "string" || typeof body.prompt !== "string" || body.prompt.trim() === "") {
      return reply.code(400).send({ error: "projectId, agent, and prompt are required" });
    }

    try {
      const run = service.startCodingRun(body.projectId, body.agent, body.prompt);
      return { run };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("unknown project id") ? 404 : 400;
      return reply.code(code).send({ error: message });
    }
  });

  // POST /api/chat/bash-runs
  app.post("/api/chat/bash-runs", async (request, reply) => {
    const body = request.body as { projectId?: unknown; command?: unknown };
    if (typeof body.projectId !== "string" || typeof body.command !== "string" || body.command.trim() === "") {
      return reply.code(400).send({ error: "projectId and command are required" });
    }

    try {
      const run = service.startBashRun(body.projectId, body.command);
      return { run };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("unknown project id") ? 404 : 400;
      return reply.code(code).send({ error: message });
    }
  });

  // GET /api/chat/runs/:id/events
  app.get("/api/chat/runs/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = service.getCodingRun(id);
    if (!run) {
      return reply.code(404).send({ error: "unknown coding run" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    });
    const emit = (snapshot: typeof run) => reply.raw.write(`event: run\ndata: ${JSON.stringify(snapshot)}\n\n`);
    emit(run);
    const unsubscribe = service.subscribeCodingRun(id, emit);
    request.raw.on("close", () => {
      unsubscribe();
      reply.raw.end();
    });
  });

  // POST /api/chat/runs/:id/stop
  app.post("/api/chat/runs/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const run = service.stopCodingRun(id);
      return { run };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/inventory
  app.get("/api/inventory", async () => {
    return service.getInventory();
  });

  app.get("/api/guidance/sessions", async (request, reply) => {
    const { projectId } = request.query as { projectId?: string };
    if (!projectId) return reply.code(400).send({ error: "projectId is required" });
    try {
      return service.listGuidanceSessions(projectId);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/guidance/info", async (request, reply) => {
    const { projectId } = request.query as { projectId?: string };
    if (!projectId) return reply.code(400).send({ error: "projectId is required" });
    try {
      return await service.getGuidanceReviewInfo(projectId);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/guidance/history", async (request, reply) => {
    const { projectId, sessionId, cursor } = request.query as { projectId?: string; sessionId?: string; cursor?: string };
    if (!projectId || !sessionId) return reply.code(400).send({ error: "projectId and sessionId are required" });
    try {
      return await service.getGuidanceHistory(projectId, sessionId, cursor);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/guidance/tool", async (request, reply) => {
    const { projectId, callRef, section, cursor } = request.query as { projectId?: string; callRef?: string; section?: string; cursor?: string };
    if (!projectId || !callRef || (section !== "input" && section !== "output" && section !== "error")) {
      return reply.code(400).send({ error: "projectId, callRef, and a valid section are required" });
    }
    try {
      return await service.getGuidanceToolPayload(projectId, callRef, section, cursor);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/guidance/reviews", async (request, reply) => {
    const body = request.body as { projectId?: unknown; sessionIds?: unknown };
    if (typeof body.projectId !== "string" || !Array.isArray(body.sessionIds) || !body.sessionIds.every((id) => typeof id === "string")) {
      return reply.code(400).send({ error: "projectId and sessionIds are required" });
    }
    try {
      return { review: await service.startGuidanceReview(body.projectId, body.sessionIds) };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/guidance/reviews/:id", async (request, reply) => {
    try {
      return { review: await service.getGuidanceReview((request.params as { id: string }).id) };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/guidance/reviews/:id/cancel", async (request, reply) => {
    try {
      return { review: await service.cancelGuidanceReview((request.params as { id: string }).id) };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/guidance/reviews/:id/apply", async (request, reply) => {
    const body = request.body as { editIds?: unknown };
    if (!Array.isArray(body.editIds) || !body.editIds.every((id) => typeof id === "string")) return reply.code(400).send({ error: "editIds are required" });
    try {
      return { review: await service.applyGuidanceReview((request.params as { id: string }).id, body.editIds) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/guidance/reviews/:id", async (request, reply) => {
    try {
      await service.deleteGuidanceReview((request.params as { id: string }).id);
      return reply.code(204).send();
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/docs?id=<projectId>
  app.get("/api/docs", async (request, reply) => {
    const { id } = request.query as { id?: string };
    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }
    try {
      return await service.getDocFiles(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("unknown project id") ? 404 : 400;
      return reply.code(code).send({ error: message });
    }
  });

  // GET /api/doc?id=<projectId>&file=<relPath>
  app.get("/api/doc", async (request, reply) => {
    const { id, file } = request.query as { id?: string; file?: string };
    if (!id || !file) {
      return reply.code(400).send({ error: "id and file are required" });
    }
    try {
      return await service.getDocContent(id, file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("unknown project id") || message.includes("file not found") ? 404 : 400;
      return reply.code(code).send({ error: message });
    }
  });

  // POST /api/scan
  app.post("/api/scan", async (request) => {
    const body = request.body as { fetch?: boolean };
    return service.runScan(body?.fetch === true);
  });

  // POST /api/refresh/quick
  app.post("/api/refresh/quick", async () => {
    return service.quickRefresh();
  });

  // POST /api/annotation
  app.post("/api/annotation", async (request, reply) => {
    try {
      const validation = parseAndValidateAnnotationBody(request.body);
      if (validation.error) {
        return reply.code(400).send({ error: validation.error });
      }
      const { id, patch } = validation.data!;
      return await service.saveAnnotation(id, patch);
    } catch (error) {
      app.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /api/annotations/batch
  app.post("/api/annotations/batch", async (request, reply) => {
    try {
      const validation = parseAndValidateBatchAnnotationBody(request.body);
      if (validation.error) {
        return reply.code(400).send({ error: validation.error });
      }
      const { ids, patch } = validation.data!;
      return await service.saveBatchAnnotations(ids, patch);
    } catch (error) {
      app.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /api/script
  app.post("/api/script", async (request, reply) => {
    try {
      const body = request.body as { action?: unknown; ids?: unknown };
      if (typeof body.action !== "string") {
        return reply.code(400).send({ error: "action is required and must be a string" });
      }
      if (!Array.isArray(body.ids) || body.ids.length === 0 || !body.ids.every((id) => typeof id === "string")) {
        return reply.code(400).send({ error: "ids is required and must be a non-empty array of strings" });
      }
      return await service.generateScript(body.action, body.ids as string[]);
    } catch (error) {
      app.log.error(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /api/open
  app.post("/api/open", async (request, reply) => {
    const body = request.body as { id?: unknown; ide?: unknown };
    if (typeof body.id !== "string" || body.id === "") {
      return reply.code(400).send({ error: "id is required" });
    }
    if (typeof body.ide !== "string") {
      return reply.code(400).send({ error: "ide is required" });
    }
    try {
      return await service.openInIde(body.id, body.ide);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("unknown project id") ? 404 : 500;
      return reply.code(code).send({ error: message });
    }
  });

  // POST /api/fetch
  app.post("/api/fetch", async (request, reply) => {
    const body = request.body as { id?: unknown };
    if (typeof body.id !== "string" || body.id === "") {
      return reply.code(400).send({ error: "id is required" });
    }
    try {
      return await service.fetchProject(body.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("unknown project id") ? 404 : 500;
      return reply.code(code).send({ error: message });
    }
  });

  // POST /api/scan-project
  app.post("/api/scan-project", async (request, reply) => {
    const body = request.body as { id?: unknown; fetch?: unknown };
    if (typeof body.id !== "string" || body.id === "") {
      return reply.code(400).send({ error: "id is required and must be a non-empty string" });
    }
    try {
      return await service.scanProject(body.id, body.fetch === true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("unknown project id") || message.includes("not found") ? 404 : 500;
      return reply.code(code).send({ error: message });
    }
  });

  // POST /api/execute-action
  app.post("/api/execute-action", async (request, reply) => {
    const body = request.body as { id?: unknown; action?: unknown };
    if (typeof body.id !== "string" || body.id === "") {
      return reply.code(400).send({ error: "id is required and must be a non-empty string" });
    }
    if (typeof body.action !== "string" || body.action === "") {
      return reply.code(400).send({ error: "action is required and must be a non-empty string" });
    }
    try {
      return await service.executeAction(body.id, body.action);
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Catch-all for SPA
  app.setNotFoundHandler((request, reply) => {
    if (!hasFrontend || request.url.startsWith("/api/")) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.sendFile("index.html");
  });

  return { app, service, agentToolsService };
}

export async function startServer(options: ServerOptions): Promise<string> {
  const { app } = await createApp({
    baseDir: options.baseDir,
    serveStatic: options.serveStatic,
  });
  await app.listen({ port: options.port, host: "127.0.0.1" });
  const address = `http://127.0.0.1:${options.port}`;
  return address;
}
