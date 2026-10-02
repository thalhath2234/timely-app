import {
  app,
  ipcMain,
  Notification,
  BrowserWindow,
  Menu,
  dialog,
  shell,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { isOpenableExternally, isSameOrigin } from "./origin";

const DEFAULT_RENDERER_URL = "http://127.0.0.1:4001";
const WAIT_TIMEOUT_MS = 120_000;

let mainWindow: BrowserWindow | null = null;
let nextProcess: ChildProcess | null = null;
const deliveredChats = new Set<string>();
ipcMain.on("chat:notify", (event, payload: unknown) => {
  const win = mainWindow;
  if (!win || win.isDestroyed() || event.sender !== win.webContents || win.isFocused() || !Notification.isSupported()) return;
  if (!payload || typeof payload !== "object") return;
  const data = payload as Record<string, unknown>;
  if (typeof data.id !== "string" || !/^chat_[a-zA-Z0-9-]+$/.test(data.id) || typeof data.title !== "string" || typeof data.body !== "string" || typeof data.revision !== "number") return;
  const key = `${data.id}:${data.revision}`;
  if (deliveredChats.has(key)) return;
  deliveredChats.add(key);
  if (deliveredChats.size > 1000) deliveredChats.delete(deliveredChats.values().next().value!);
  const notification = new Notification({ title: data.title.slice(0, 100), body: data.body.slice(0, 200) });
  notification.on("click", () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus(); win.webContents.send("chat:open", data.id);
  });
  notification.show();
});

function isDev() {
  return process.env.ELECTRON_DEV === "1" || !app.isPackaged;
}

function loadEnvFiles() {
  const candidates = [
    // Repo-root .env when running from the checkout (dist-electron → apps/web → repo).
    path.join(__dirname, "..", "..", "..", ".env"),
    path.join(process.cwd(), ".env"),
    path.join(app.getPath("userData"), ".env"),
  ];
  if (app.isPackaged) {
    candidates.unshift(path.join(process.resourcesPath, ".env"));
  }
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    process.loadEnvFile(file);
    break;
  }
}

function listenPort(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Failed to allocate a TCP port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function getAvailablePort(preferred: number) {
  try {
    return await listenPort(preferred, "127.0.0.1");
  } catch {
    return listenPort(0, "127.0.0.1");
  }
}

async function waitForUrl(url: string, timeoutMs: number) {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(1500),
      });
      if (response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for ${url}`);
}

function standaloneServerPath() {
  const root = path.join(process.resourcesPath, "next-server");
  const nested = path.join(root, "apps", "web", "server.js");
  const flat = path.join(root, "server.js");
  if (existsSync(nested)) return { root, server: nested };
  if (existsSync(flat)) return { root, server: flat };
  return null;
}

function startStandaloneServer(port: number) {
  const located = standaloneServerPath();
  if (!located) {
    throw new Error("Packaged Next.js server is missing from extra resources.");
  }

  const nodeBinary = process.env.ELECTRON_NODE_BINARY || process.execPath;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    API_ORIGIN: process.env.API_ORIGIN || "http://127.0.0.1:8080",
  };
  if (!process.env.ELECTRON_NODE_BINARY) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }

  nextProcess = spawn(nodeBinary, [located.server], {
    cwd: located.root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  nextProcess.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[next] ${chunk}`);
  });
  nextProcess.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[next] ${chunk}`);
  });
  nextProcess.on("exit", (code, signal) => {
    nextProcess = null;
    if (code && code !== 0) {
      console.error(`Next.js server exited (${code}${signal ? `/${signal}` : ""})`);
    }
  });
}

async function resolveRendererUrl() {
  if (process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL;
  }
  if (!app.isPackaged) {
    return DEFAULT_RENDERER_URL;
  }

  const port = await getAvailablePort(4001);
  startStandaloneServer(port);
  return `http://127.0.0.1:${port}`;
}

function installApplicationMenu() {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: "appMenu" as const }] : []),
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

function attachWindowGuards(win: BrowserWindow, rendererUrl: string) {
  const origin = new URL(rendererUrl).origin;

  // Only the renderer's exact origin may open inside the app; anything else
  // goes to the system browser, and URLs we cannot parse or hand off are dropped.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, origin)) {
      return { action: "allow" };
    }
    if (isOpenableExternally(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isSameOrigin(url, origin)) return;
    event.preventDefault();
    if (isOpenableExternally(url)) void shell.openExternal(url);
  });
}

async function createWindow(rendererUrl: string) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Timely",
    show: false,
    autoHideMenuBar: process.platform === "linux",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      backgroundThrottling: false,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  attachWindowGuards(win, rendererUrl);
  win.once("ready-to-show", () => win.show());
  await win.loadURL(rendererUrl);
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
}

function stopStandaloneServer() {
  if (!nextProcess) return;
  nextProcess.kill();
  nextProcess = null;
}

async function boot() {
  loadEnvFiles();
  installApplicationMenu();

  const rendererUrl = await resolveRendererUrl();
  try {
    await waitForUrl(rendererUrl, WAIT_TIMEOUT_MS);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const hint = isDev()
      ? "Start the Next.js server with `make dev-web`, or set ELECTRON_RENDERER_URL."
      : "Set ELECTRON_RENDERER_URL to a running Timely web app, or keep API_ORIGIN/JWT_SECRET in userData/.env so the bundled server can start.";
    await dialog.showErrorBox(
      "Timely failed to start",
      `Could not reach the web app at ${rendererUrl}.\n\n${detail}\n\n${hint}`,
    );
    app.quit();
    return;
  }

  await createWindow(rendererUrl);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow(rendererUrl);
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.setName("Timely");
  if (process.platform === "win32") {
    app.setAppUserModelId("app.timely.desktop");
  }

  app.whenReady().then(() => void boot());
  app.on("before-quit", () => stopStandaloneServer());
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
