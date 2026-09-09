import { BrowserWindow, ipcMain, dialog, type IpcMainInvokeEvent } from "electron";
import { InventoryService, type AnnotationPatch, type AppConfig } from "../server/service.ts";
import { parseChatRequest } from "../server/chat.ts";
import { AgentToolsCatalog } from "../server/agentTools/catalog.ts";
import { AgentToolsService } from "../server/agentTools/service.ts";
import type { AgentToolId, OpenConfigurationRequest } from "../core/types.ts";

export function registerIpcHandlers(baseDir: string): InventoryService {
  const service = new InventoryService(baseDir);
  const activeUnsubscribers = new Map<string, () => void>();
  const activeChatControllers = new Map<string, AbortController>();

  service.onScanProgress((progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("inventory:scanProgress", progress);
      }
    }
  });

  ipcMain.handle("inventory:getHealth", async () => {
    return service.getHealth();
  });

  ipcMain.handle("inventory:getInventory", async () => {
    return service.getInventory();
  });

  ipcMain.handle("inventory:quickRefresh", async () => {
    return service.quickRefresh();
  });

  ipcMain.handle("inventory:runScan", async (_event: IpcMainInvokeEvent, fetchRemotes: boolean) => {
    return service.runScan(fetchRemotes);
  });

  ipcMain.handle(
    "inventory:saveAnnotation",
    async (_event: IpcMainInvokeEvent, id: string, patch: AnnotationPatch) => {
      return service.saveAnnotation(id, patch);
    },
  );

  ipcMain.handle(
    "inventory:saveBatchAnnotations",
    async (_event: IpcMainInvokeEvent, ids: string[], patch: AnnotationPatch) => {
      return service.saveBatchAnnotations(ids, patch);
    },
  );

  ipcMain.handle(
    "inventory:generateScript",
    async (_event: IpcMainInvokeEvent, action: string, ids: string[]) => {
      return service.generateScript(action, ids);
    },
  );

  ipcMain.handle("inventory:getDocFiles", async (_event: IpcMainInvokeEvent, id: string) => {
    return service.getDocFiles(id);
  });

  ipcMain.handle(
    "inventory:getDocContent",
    async (_event: IpcMainInvokeEvent, id: string, file: string) => {
      return service.getDocContent(id, file);
    },
  );

  ipcMain.handle("inventory:openInIde", async (_event: IpcMainInvokeEvent, id: string, ide: string) => {
    return service.openInIde(id, ide);
  });

  ipcMain.handle("inventory:fetchProject", async (_event: IpcMainInvokeEvent, id: string) => {
    return service.fetchProject(id);
  });

  ipcMain.handle(
    "inventory:scanProject",
    async (_event: IpcMainInvokeEvent, id: string, fetchRemotes?: boolean) => {
      return service.scanProject(id, fetchRemotes ?? true);
    },
  );

  ipcMain.handle(
    "inventory:executeAction",
    async (_event: IpcMainInvokeEvent, id: string, action: string) => {
      return service.executeAction(id, action);
    },
  );

  ipcMain.handle("inventory:listGuidanceSessions", async (_event: IpcMainInvokeEvent, projectId: string) => {
    return service.listGuidanceSessions(projectId);
  });
  ipcMain.handle("inventory:getGuidanceReviewInfo", async (_event: IpcMainInvokeEvent, projectId: string) => {
    return service.getGuidanceReviewInfo(projectId);
  });
  ipcMain.handle(
    "inventory:getGuidanceHistory",
    async (_event: IpcMainInvokeEvent, projectId: string, sessionId: string, cursor?: string) => {
      return service.getGuidanceHistory(projectId, sessionId, cursor);
    },
  );
  ipcMain.handle(
    "inventory:getGuidanceToolPayload",
    async (_event: IpcMainInvokeEvent, projectId: string, callRef: string, section: "input" | "output" | "error", cursor?: string) => {
      return service.getGuidanceToolPayload(projectId, callRef, section, cursor);
    },
  );
  ipcMain.handle(
    "inventory:startGuidanceReview",
    async (_event: IpcMainInvokeEvent, projectId: string, sessionIds: string[]) => service.startGuidanceReview(projectId, sessionIds),
  );
  ipcMain.handle("inventory:getGuidanceReview", async (_event: IpcMainInvokeEvent, reviewId: string) => service.getGuidanceReview(reviewId));
  ipcMain.handle("inventory:cancelGuidanceReview", async (_event: IpcMainInvokeEvent, reviewId: string) => service.cancelGuidanceReview(reviewId));
  ipcMain.handle(
    "inventory:applyGuidanceReview",
    async (_event: IpcMainInvokeEvent, reviewId: string, editIds: string[]) => service.applyGuidanceReview(reviewId, editIds),
  );
  ipcMain.handle("inventory:deleteGuidanceReview", async (_event: IpcMainInvokeEvent, reviewId: string) => service.deleteGuidanceReview(reviewId));

  ipcMain.handle("inventory:getCodingAgents", async () => {
    return service.getCodingAgents();
  });

  ipcMain.handle(
    "inventory:startCodingRun",
    async (_event: IpcMainInvokeEvent, projectId: string, agent: string, prompt: string) => {
      return service.startCodingRun(projectId, agent, prompt);
    },
  );

  ipcMain.handle(
    "inventory:startBashRun",
    async (_event: IpcMainInvokeEvent, projectId: string, command: string) => {
      return service.startBashRun(projectId, command);
    },
  );

  ipcMain.handle("inventory:stopCodingRun", async (_event: IpcMainInvokeEvent, id: string) => {
    return service.stopCodingRun(id);
  });

  ipcMain.handle(
    "inventory:subscribeCodingRun",
    async (event: IpcMainInvokeEvent, payload: { channelId: string; runId: string }) => {
      const { channelId, runId } = payload;
      const run = service.getCodingRun(runId);
      if (run && !event.sender.isDestroyed()) {
        event.sender.send(channelId, run);
      }
      const unsubscribe = service.subscribeCodingRun(runId, (snapshot) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(channelId, snapshot);
        }
      });
      activeUnsubscribers.set(channelId, unsubscribe);
      return { ok: true };
    },
  );

  ipcMain.handle(
    "inventory:unsubscribeCodingRun",
    async (_event: IpcMainInvokeEvent, payload: { channelId: string }) => {
      const unsub = activeUnsubscribers.get(payload.channelId);
      if (unsub) {
        unsub();
        activeUnsubscribers.delete(payload.channelId);
      }
      return { ok: true };
    },
  );

  ipcMain.handle(
    "inventory:streamChat",
    async (
      event: IpcMainInvokeEvent,
      payload: { channelId: string; request: { messages: unknown[]; projectId?: string; preferredAgent?: string } },
    ) => {
      const { channelId, request } = payload;
      const parsed = parseChatRequest(request);
      if (!parsed.data) {
        if (!event.sender.isDestroyed()) {
          event.sender.send(channelId, { done: true, error: parsed.error ?? "Invalid request" });
        }
        return { ok: false };
      }

      const controller = new AbortController();
      activeChatControllers.set(channelId, controller);

      service
        .streamChat(
          parsed.data,
          (chatEvent) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(channelId, { event: chatEvent });
            }
          },
          controller.signal,
        )
        .then(() => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(channelId, { done: true });
          }
        })
        .catch((error: unknown) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(channelId, {
              done: true,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })
        .finally(() => {
          activeChatControllers.delete(channelId);
        });

      return { ok: true };
    },
  );

  ipcMain.handle(
    "inventory:cancelStreamChat",
    async (_event: IpcMainInvokeEvent, payload: { channelId: string }) => {
      const controller = activeChatControllers.get(payload.channelId);
      if (controller) {
        controller.abort();
        activeChatControllers.delete(payload.channelId);
      }
      return { ok: true };
    },
  );

  ipcMain.handle("inventory:getConfig", async () => {
    return service.getConfig();
  });

  ipcMain.handle(
    "inventory:saveConfig",
    async (
      _event: IpcMainInvokeEvent,
      updates: Parameters<typeof service.saveConfig>[0],
    ) => {
      return service.saveConfig(updates);
    },
  );

  ipcMain.handle("inventory:selectDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Select Directory to Scan",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  const agentToolsService = new AgentToolsService(
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

  ipcMain.handle("agentTools:list", async () => {
    return agentToolsService.listTools();
  });

  ipcMain.handle("agentTools:refresh", async () => {
    return agentToolsService.refresh();
  });

  ipcMain.handle("agentTools:getDetails", async (_event: IpcMainInvokeEvent, id: AgentToolId) => {
    return agentToolsService.getToolDetails(id);
  });

  ipcMain.handle("agentTools:readResource", async (_event: IpcMainInvokeEvent, ref: string) => {
    return agentToolsService.readResource(ref);
  });

  ipcMain.handle("agentTools:openConfiguration", async (_event: IpcMainInvokeEvent, req: OpenConfigurationRequest) => {
    return agentToolsService.openConfiguration(req.ref, req.action, req.ide);
  });

  ipcMain.handle("agentTools:readSessionTranscript", async (_event: IpcMainInvokeEvent, id: string, cursor?: string) => {
    return agentToolsService.readSessionTranscript(id, cursor);
  });

  return service;
}
