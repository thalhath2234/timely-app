// Preload for the boot screen (electron/boot.html). Exposes only what the
// static page needs: progress updates, "Open logs" and "Quit".
import { contextBridge, ipcRenderer } from "electron";

export type BootStatusPayload = {
  steps: { id: string; label: string; state: "pending" | "running" | "done" | "failed"; detail?: string }[];
  error?: { title: string; message: string } | null;
};

contextBridge.exposeInMainWorld("timelyBoot", {
  onStatus: (callback: (status: BootStatusPayload) => void) => {
    const handler = (_event: unknown, status: BootStatusPayload) => callback(status);
    ipcRenderer.on("boot:status", handler);
    return () => ipcRenderer.removeListener("boot:status", handler);
  },
  ready: () => ipcRenderer.send("boot:ready"),
  openLogs: () => ipcRenderer.send("boot:open-logs"),
  quit: () => ipcRenderer.send("boot:quit"),
});
