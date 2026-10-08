import {
  app,
  ipcMain,
  Notification,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  nativeImage,
  safeStorage,
  shell,
} from "electron";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { FLAVOR } from "./flavor";
import { isOpenableExternally, isPermissionAllowed, isSameOrigin } from "./origin";
import { waitForHttp } from "./supervisor/api";
import { makeSealer } from "./supervisor/config";
import { checkPrivileges } from "./supervisor/guards";
import { ACTIONS, BootError, SETTING_KEYS, Supervisor, type BootProgress, type BootStep } from "./supervisor/index";
import { resolveResourceDirs } from "./supervisor/paths";
import { createElectronUpdater } from "./supervisor/updater";
import type { DesktopAction, DesktopSettingKey, PageTabCommand } from "../electron-env";

const DEFAULT_RENDERER_URL = "http://127.0.0.1:4001";
const WAIT_TIMEOUT_MS = 120_000;

/**
 * Hosted mode: the app supervises Postgres, the API and the Next server
 * itself (packaged builds, or TIMELY_HOSTED=1 against staged resources).
 * Dev mode keeps `make dev-desktop` unchanged: external servers, no sidecars.
 */
const HOSTED = app.isPackaged || process.env.TIMELY_HOSTED === "1";

let mainWindow: BrowserWindow | null = null;
let bootWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let supervisor: Supervisor | null = null;
let rendererUrl = DEFAULT_RENDERER_URL;
let quitting = false;

// ---------------------------------------------------------------------------
// Chat notifications (unchanged API)
// ---------------------------------------------------------------------------

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
  const notification = new Notification({
    title: data.title.slice(0, 100),
    body: data.body.slice(0, 200),
    icon: notificationIcon(),
  });
  notification.on("click", () => {
    if (win.isDestroyed()) return;
    showMainWindow();
    win.webContents.send("chat:open", data.id);
  });
  notification.show();
});

// ---------------------------------------------------------------------------
// Doc PDF export: the renderer lays the doc out for print, this saves it.
// ---------------------------------------------------------------------------

ipcMain.handle("doc:savePdf", async (event, title: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return { ok: false };
  if (!isSameOrigin(event.senderFrame.url, new URL(rendererUrl).origin)) return { ok: false };
  const name = (typeof title === "string" ? title : "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 120) || "Untitled";
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath("documents"), `${name}.pdf`),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const data = await event.sender.printToPDF({ printBackground: true, pageSize: "A4", preferCSSPageSize: true });
  await writeFile(filePath, data);
  return { ok: true, filePath };
});

// ---------------------------------------------------------------------------
// Instance bridge (hosted mode only)
// ---------------------------------------------------------------------------

function fromMainWindow(event: Electron.IpcMainInvokeEvent): boolean {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

ipcMain.handle("instance:get", async (event) => {
  if (!supervisor || !fromMainWindow(event)) throw new Error("Not available");
  return supervisor.getInstanceFresh();
});

ipcMain.handle("instance:setSetting", async (event, key: unknown, value: unknown) => {
  if (!supervisor || !fromMainWindow(event)) throw new Error("Not available");
  if (typeof key !== "string" || !SETTING_KEYS.includes(key as DesktopSettingKey)) throw new Error("Unknown setting");
  if (typeof value !== "boolean") throw new Error("Setting values must be booleans");
  return supervisor.setSetting(key as DesktopSettingKey, value);
});

ipcMain.handle("instance:action", async (event, name: unknown) => {
  if (!supervisor || !fromMainWindow(event)) return { ok: false, error: "Not available" };
  if (typeof name !== "string" || !ACTIONS.includes(name as DesktopAction)) return { ok: false, error: "Unknown action" };
  return supervisor.action(name as DesktopAction);
});

ipcMain.on("boot:open-logs", (event) => {
  if (!bootWindow || event.sender !== bootWindow.webContents) return;
  const dir = supervisor?.paths.logDir ?? path.join(app.getPath("userData"), "logs");
  void shell.openPath(dir);
});
ipcMain.on("boot:quit", (event) => {
  if (!bootWindow || event.sender !== bootWindow.webContents) return;
  requestQuit();
});

// ---------------------------------------------------------------------------
// Doc/sheet tab shortcuts
// ---------------------------------------------------------------------------

// Pages whose doc/sheet tab strip is showing. Only those get Ctrl/Cmd+W and
// friends as tab commands; everywhere else the menu's own shortcuts apply.
const pageTabPages = new Set<number>();

ipcMain.on("pageTabs:active", (event, active: unknown) => {
  if (active === true) pageTabPages.add(event.sender.id);
  else pageTabPages.delete(event.sender.id);
});

function pageTabCommand(input: Electron.Input): PageTabCommand | null {
  if (input.type !== "keyDown") return null;
  const key = input.key.toLowerCase();
  const mod = process.platform === "darwin" ? input.meta : input.control;
  if (mod && !input.shift && !input.alt && key === "t") return "new";
  if (mod && !input.shift && !input.alt && key === "w") return "close";
  if (input.control && !input.alt && key === "tab") return input.shift ? "previous" : "next";
  // macOS keeps Option+arrows for moving by word, so it gets Cmd+[ and Cmd+].
  if (process.platform === "darwin") {
    if (input.meta && !input.shift && !input.alt && key === "[") return "back";
    if (input.meta && !input.shift && !input.alt && key === "]") return "forward";
    return null;
  }
  if (input.alt && !input.control && !input.meta && key === "arrowleft") return "back";
  if (input.alt && !input.control && !input.meta && key === "arrowright") return "forward";
  return null;
}

// Menu accelerators fire before the page sees the key, so tab shortcuts are
// caught here and handed to the page instead.
function attachPageTabShortcuts(contents: Electron.WebContents) {
  contents.on("before-input-event", (event, input) => {
    if (!pageTabPages.has(contents.id)) return;
    const command = pageTabCommand(input);
    if (!command) return;
    event.preventDefault();
    contents.send("pageTabs:command", command);
  });
  contents.on("destroyed", () => pageTabPages.delete(contents.id));
  contents.on("did-create-window", (child) => attachPageTabShortcuts(child.webContents));
}

// ---------------------------------------------------------------------------
// Dev mode helpers (unchanged behaviour)
// ---------------------------------------------------------------------------

function loadEnvFiles() {
  const candidates = [
    // Repo-root .env when running from the checkout (dist-electron → apps/web → repo).
    path.join(__dirname, "..", "..", "..", ".env"),
    path.join(process.cwd(), ".env"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    process.loadEnvFile(file);
    break;
  }
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

function attachWindowGuards(win: BrowserWindow, url: string) {
  const origin = new URL(url).origin;

  // Only the renderer's exact origin may open inside the app; anything else
  // goes to the system browser, and URLs we cannot parse or hand off are dropped.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isSameOrigin(target, origin)) {
      return { action: "allow" };
    }
    if (isOpenableExternally(target)) void shell.openExternal(target);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, target) => {
    if (isSameOrigin(target, origin)) return;
    event.preventDefault();
    if (isOpenableExternally(target)) void shell.openExternal(target);
  });

  // Same-origin popups (e.g. "open doc in new window") get the same guards,
  // or a link clicked inside them would open the target page in-app.
  win.webContents.on("did-create-window", (child) => attachWindowGuards(child, url));
}

/**
 * Electron grants every web permission by default. Only the renderer's own
 * origin may use the few the app needs (clipboard, fullscreen).
 */
function attachPermissionGuards(win: BrowserWindow, url: string) {
  const origin = new URL(url).origin;
  const session = win.webContents.session;
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isPermissionAllowed(permission, details.requestingUrl, origin));
  });
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isPermissionAllowed(permission, requestingOrigin, origin),
  );
}

/**
 * The Timely mark, shipped at electron/resources/icon.png. Packaged builds
 * get their dock/taskbar icon from electron-builder; the window icon covers
 * `make dev-desktop` and unpacked Linux/Windows builds.
 */
function windowIcon(): string | undefined {
  const icon = path.join(app.getAppPath(), "electron", "resources", "icon.png");
  return existsSync(icon) ? icon : undefined;
}

/**
 * Linux and Windows notifications show no app icon unless one is passed;
 * macOS ignores this and uses the bundle icon.
 */
let cachedNotificationIcon: Electron.NativeImage | undefined;
function notificationIcon(): Electron.NativeImage | undefined {
  if (cachedNotificationIcon) return cachedNotificationIcon;
  const icon = windowIcon();
  if (!icon) return undefined;
  cachedNotificationIcon = nativeImage.createFromPath(icon).resize({ width: 256, height: 256 });
  return cachedNotificationIcon;
}

function showMainWindow() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    if (HOSTED && supervisor?.isBooted) void createWindow(rendererUrl);
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function createWindow(url: string) {
  const isWindows = process.platform === "win32";
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: FLAVOR.name,
    icon: windowIcon(),
    show: false,
    autoHideMenuBar: process.platform === "linux",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      backgroundThrottling: false,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: HOSTED ? ["--timely-hosted"] : [],
    },
  });

  // Windows: no File/Edit/View/Window bar (the menu stays installed so its
  // shortcuts still work) and the window opens maximized above the taskbar.
  if (isWindows) win.setMenuBarVisibility(false);

  attachWindowGuards(win, url);
  attachPermissionGuards(win, url);
  attachPageTabShortcuts(win.webContents);
  // Local builds say so in the title bar, next to an installed release.
  if (!FLAVOR.release) {
    win.on("page-title-updated", (event, title) => {
      event.preventDefault();
      win.setTitle(`${title} (Dev)`);
    });
  }
  win.once("ready-to-show", () => {
    if (isWindows) win.maximize();
    win.show();
    closeBootWindow();
  });
  // Hosted: closing the window hides it; the sidecars keep running until
  // "Quit Timely" (tray or app menu).
  win.on("close", (event) => {
    if (!HOSTED || quitting) return;
    event.preventDefault();
    win.hide();
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  // The desktop app opens on the product, not the landing page at "/": the
  // web proxy sends a signed-out window on to the login page.
  await win.loadURL(new URL("/calendar", url).toString());
}

// ---------------------------------------------------------------------------
// Boot screen
// ---------------------------------------------------------------------------

const BOOT_LABELS: Record<BootStep, string> = { postgres: "Starting database", api: "Starting server", web: "Starting app" };
const bootSteps: Record<BootStep, BootProgress> = {
  postgres: { step: "postgres", state: "pending" },
  api: { step: "api", state: "pending" },
  web: { step: "web", state: "pending" },
};
let bootError: { title: string; message: string } | null = null;
let bootPageReady = false;

function sendBootStatus() {
  if (!bootWindow || bootWindow.isDestroyed() || !bootPageReady) return;
  bootWindow.webContents.send("boot:status", {
    steps: (Object.keys(bootSteps) as BootStep[]).map((step) => ({
      id: step,
      label: BOOT_LABELS[step],
      state: bootSteps[step].state,
      detail: bootSteps[step].detail,
    })),
    error: bootError,
  });
}

ipcMain.on("boot:ready", (event) => {
  if (!bootWindow || event.sender !== bootWindow.webContents) return;
  bootPageReady = true;
  sendBootStatus();
});

function bootHtmlPath(): string {
  const dist = path.join(__dirname, "boot.html");
  if (existsSync(dist)) return dist;
  return path.join(app.getAppPath(), "electron", "boot.html");
}

async function createBootWindow() {
  const win = new BrowserWindow({
    width: 440,
    height: 380,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: FLAVOR.name,
    icon: windowIcon(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "boot-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win.show());
  win.on("close", (event) => {
    // Closing the boot screen while booting means "stop": quit cleanly.
    if (quitting) return;
    event.preventDefault();
    requestQuit();
  });
  win.on("closed", () => {
    if (bootWindow === win) bootWindow = null;
  });
  bootWindow = win;
  await win.loadFile(bootHtmlPath());
}

function closeBootWindow() {
  const win = bootWindow;
  bootWindow = null;
  if (win && !win.isDestroyed()) {
    win.removeAllListeners("close");
    win.close();
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function trayIcon() {
  const icon = windowIcon();
  if (!icon) return nativeImage.createEmpty();
  const size = process.platform === "darwin" ? 18 : 16;
  return nativeImage.createFromPath(icon).resize({ width: size, height: size });
}

function rebuildTrayMenu() {
  if (!tray || !supervisor) return;
  const instance = supervisor.getInstance();
  const serverLabel =
    instance.api.status === "running"
      ? `Server: running on ${instance.api.localUrl}`
      : `Server: ${instance.api.status}${instance.api.lastError ? ` (${instance.api.lastError})` : ""}`;
  tray.setToolTip(`${FLAVOR.name} — ${serverLabel}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${FLAVOR.name}`, click: () => showMainWindow() },
      { label: serverLabel, enabled: false },
      { type: "separator" },
      { label: "Copy address", click: () => void supervisor?.action("copyAddress") },
      {
        label: "Back up now",
        click: async () => {
          const result = await supervisor?.action("backupNow");
          if (result && !result.ok) {
            dialog.showErrorBox("Backup failed", result.error);
          } else if (result?.message && Notification.isSupported()) {
            new Notification({ title: "Timely backup", body: result.message, icon: notificationIcon() }).show();
          }
        },
      },
      { type: "separator" },
      { label: `Quit ${FLAVOR.name}`, click: () => requestQuit() },
    ]),
  );
}

function installTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.on("click", () => showMainWindow());
  rebuildTrayMenu();
}

// ---------------------------------------------------------------------------
// Quit
// ---------------------------------------------------------------------------

function requestQuit() {
  if (quitting) return;
  quitting = true;
  void (async () => {
    try {
      if (supervisor) await supervisor.shutdown();
    } finally {
      app.exit(0);
    }
  })();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function bootHosted() {
  const guard = checkPrivileges();
  if (!guard.ok) {
    dialog.showErrorBox(guard.title, guard.message);
    app.exit(1);
    return;
  }

  const userData = app.getPath("userData");
  const resources = resolveResourceDirs({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  const encryptionAvailable = safeStorage.isEncryptionAvailable();
  supervisor = new Supervisor({
    userData,
    resources,
    version: app.getVersion(),
    sealer: makeSealer({
      available: encryptionAvailable,
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (sealed) => safeStorage.decryptString(sealed),
    }),
    nodeBinary: process.env.ELECTRON_NODE_BINARY || process.execPath,
    runAsNode: !process.env.ELECTRON_NODE_BINARY,
    openPath: (target) => shell.openPath(target),
    writeClipboard: (text) => clipboard.writeText(text),
    // A local build must not update itself into the release.
    updater: FLAVOR.release ? createElectronUpdater({ isPackaged: app.isPackaged, log: (m) => supervisor?.log.warn(m) }) : undefined,
    defaultPorts: FLAVOR.ports,
    echo: !app.isPackaged,
  });
  if (!encryptionAvailable) supervisor.log.warn("safeStorage encryption unavailable; secrets are stored with the plain: prefix (file mode 0600)");
  // Without a keyring Linux falls back to "basic_text", whose key is public:
  // the secrets are then only as safe as config.json's 0600 file mode.
  if (encryptionAvailable && process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
    supervisor.log.warn("safeStorage is using the basic_text backend (no keyring); secrets in config.json are protected only by file mode 0600");
  }

  supervisor.on("boot", (progress) => {
    bootSteps[progress.step] = progress;
    sendBootStatus();
  });
  supervisor.on("change", (instance) => {
    rebuildTrayMenu();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("instance:changed", instance);
  });

  await createBootWindow();
  installTray();

  try {
    await supervisor.boot();
  } catch (error) {
    const step = error instanceof BootError ? error.step : "postgres";
    const what = { postgres: "the database", api: "the server", web: "the app" }[step];
    const detail = error instanceof Error ? error.message : String(error);
    bootError = {
      title: `Timely could not start ${what}`,
      message: `${detail}\n\nThe logs folder has the details (supervisor.log, ${step === "web" ? "next" : step}.log).`,
    };
    sendBootStatus();
    supervisor.log.error(`boot failed at ${step}: ${detail}`);
    return;
  }

  rendererUrl = supervisor.webUrl;
  await createWindow(rendererUrl);
  rebuildTrayMenu();
}

async function bootDev() {
  loadEnvFiles();
  rendererUrl = process.env.ELECTRON_RENDERER_URL || DEFAULT_RENDERER_URL;
  try {
    await waitForHttp(rendererUrl, WAIT_TIMEOUT_MS);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      "Timely failed to start",
      `Could not reach the web app at ${rendererUrl}.\n\n${detail}\n\nStart the Next.js server with \`make dev-web\`, or set ELECTRON_RENDERER_URL.`,
    );
    app.quit();
    return;
  }
  await createWindow(rendererUrl);
}

async function boot() {
  installApplicationMenu();
  // Packaged macOS builds carry the icon in the bundle; `make dev-desktop`
  // would otherwise show Electron's default dock icon.
  const icon = windowIcon();
  if (process.platform === "darwin" && !app.isPackaged && icon) app.dock?.setIcon(icon);

  if (HOSTED) await bootHosted();
  else await bootDev();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 || (mainWindow && !mainWindow.isVisible())) showMainWindow();
  });
}

// The single-instance lock lives in userData, so a local build points
// userData at its own folder first; otherwise opening it would hand over to an
// installed release and quit. Release builds keep Electron's default
// (<appData>/Timely). An explicit --user-data-dir (make dev-desktop-hosted) wins.
if (!FLAVOR.release) {
  app.setName(FLAVOR.name);
  if (!app.commandLine.hasSwitch("user-data-dir")) {
    app.setPath("userData", path.join(app.getPath("appData"), FLAVOR.name));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());

  app.setName(FLAVOR.name);
  if (process.platform === "win32") {
    app.setAppUserModelId(FLAVOR.appId);
  }

  app.whenReady().then(() => void boot());
  app.on("before-quit", (event) => {
    if (!HOSTED) return;
    if (quitting) return;
    // Stop the sidecars first; requestQuit() calls app.exit() when done.
    event.preventDefault();
    requestQuit();
  });
  app.on("window-all-closed", () => {
    if (HOSTED) return;
    if (process.platform !== "darwin") app.quit();
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      if (HOSTED) requestQuit();
      else app.quit();
    });
  }
}
