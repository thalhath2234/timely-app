import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAction, DesktopInstance, DesktopSettingKey } from "../electron-env";

const hosted = process.argv.includes("--timely-hosted");

contextBridge.exposeInMainWorld("timelyDesktop", {
  platform: process.platform,
  notifyChat: (payload: { id: string; title: string; body: string; revision: number }) => ipcRenderer.send("chat:notify", payload),
  onOpenChat: (callback: (id: string) => void) => {
    const handler = (_event: unknown, id: string) => callback(id);
    ipcRenderer.on("chat:open", handler);
    return () => ipcRenderer.removeListener("chat:open", handler);
  },
  /** Saves the page, as laid out for print, to a PDF the user picks. */
  savePdf: (title: string): Promise<{ ok: boolean; canceled?: boolean; filePath?: string }> => ipcRenderer.invoke("doc:savePdf", title),
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
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
