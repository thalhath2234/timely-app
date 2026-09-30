import { contextBridge, ipcRenderer } from "electron";

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
});
