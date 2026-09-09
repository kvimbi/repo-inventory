import { app, BrowserWindow, Menu, type MenuItemConstructorOptions, shell, nativeImage } from "electron";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAugmentedEnv } from "../core/env.ts";
import { registerIpcHandlers } from "./ipc.ts";

ensureAugmentedEnv();

const currentDir = dirname(fileURLToPath(import.meta.url));
const appPath = app.isPackaged ? app.getAppPath() : resolve(currentDir, "..");

function getWorkingDir(): string {
  if (process.env.REPO_INVENTORY_BASE_DIR) {
    return process.env.REPO_INVENTORY_BASE_DIR;
  }
  // In development, store working state inside the repo
  if (!app.isPackaged) {
    return resolve(currentDir, "..");
  }
  // In standalone desktop app, store user data in macOS Application Support (app.getPath("userData"))
  return app.getPath("userData");
}

function getAppIcon(): { path: string; icon: ReturnType<typeof nativeImage.createFromPath> } | null {
  const candidates = [
    resolve(appPath, "build/icon.png"),
    resolve(appPath, "build/icon.icns"),
    resolve(currentDir, "../build/icon.png"),
    resolve(currentDir, "../build/icon.icns"),
    resolve(appPath, "dist/favicon.svg"),
    resolve(appPath, "web/public/favicon.svg"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const icon = nativeImage.createFromPath(candidate);
      if (!icon.isEmpty()) {
        return { path: candidate, icon };
      }
    }
  }
  return null;
}

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const workingDir = getWorkingDir();

let mainWindow: BrowserWindow | null = null;

function setupMenu() {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: () => {
                  mainWindow?.webContents.send("app:open-settings");
                },
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            mainWindow?.webContents.send("app:open-settings");
          },
        },
        { type: "separator" as const },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" as const },
        { role: "zoom" as const },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const preloadPath = resolve(currentDir, "preload.js");
  const appIcon = getAppIcon();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 840,
    minHeight: 560,
    title: "Repo Inventory",
    backgroundColor: "#0d1117",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    icon: appIcon?.icon ?? appIcon?.path,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (isDev && !app.isPackaged && process.env.USE_DEV_SERVER === "1") {
    void mainWindow.loadURL("http://127.0.0.1:4748");
  } else {
    void mainWindow.loadFile(resolve(appPath, "dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// App lifecycle & IPC routing bound to working directory
registerIpcHandlers(workingDir);

app.whenReady().then(() => {
  const appIcon = getAppIcon();
  if (process.platform === "darwin" && app.dock && appIcon?.icon) {
    app.dock.setIcon(appIcon.icon);
  }

  setupMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
