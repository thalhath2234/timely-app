import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAction, DesktopInstance, DesktopSettingKey, PageTabCommand } from "../electron-env";

const hosted = process.argv.includes("--timely-hosted");

contextBridge.exposeInMainWorld("timelyDesktop", {
  platform: process.platform,
  notifyChat: (payload: { id: string; title: string; body: string; revision: number }) => ipcRenderer.send("chat:notify", payload),
  onOpenChat: (callback: (id: string) => void) => {
    const handler = (_event: unknown, id: string) => callback(id);
    ipcRenderer.on("chat:open", handler);
    return () => ipcRenderer.removeListener("chat:open", handler);
  },
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** Doc/sheet tabs are on screen, so tab shortcuts should reach the page. */
  setPageTabsActive: (active: boolean) => ipcRenderer.send("pageTabs:active", active),
  onPageTabCommand: (callback: (command: PageTabCommand) => void) => {
    const handler = (_event: unknown, command: PageTabCommand) => callback(command);
    ipcRenderer.on("pageTabs:command", handler);
    return () => ipcRenderer.removeListener("pageTabs:command", handler);
  },
  // Present only when this app hosts its own backend (contract: docs/desktop/README.md).
  ...(hosted
    ? {
        instance: {
          get: (): Promise<DesktopInstance> => ipcRenderer.invoke("instance:get"),
          subscribe: (callback: (instance: DesktopInstance) => void) => {
            const handler = (_event: unknown, instance: DesktopInstance) => callback(instance);
            ipcRenderer.on("instance:changed", handler);
            return () => ipcRenderer.removeListener("instance:changed", handler);
          },
          setSetting: (key: DesktopSettingKey, value: boolean): Promise<DesktopInstance> =>
            ipcRenderer.invoke("instance:setSetting", key, value),
          action: (name: DesktopAction) => ipcRenderer.invoke("instance:action", name),
        },
      }
    : {}),
});
