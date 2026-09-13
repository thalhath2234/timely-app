"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Database, Download, FileSpreadsheet, RefreshCw, Trash2, Upload } from "lucide-react";
import {
  createBackup,
  deleteBackup,
  downloadPortable,
  getBackupSettings,
  listBackups,
  restoreBackup,
  updateBackupSettings,
  type BackupSettings,
} from "@/app/utils/api/portability";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DataSettings() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const settings = useQuery({ queryKey: ["backup-settings"], queryFn: getBackupSettings });
  const backups = useQuery({ queryKey: ["backups"], queryFn: listBackups });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: updateBackupSettings,
    onSuccess: (next) => queryClient.setQueryData(["backup-settings"], next),
  });
  const create = useMutation({
    mutationFn: createBackup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });
  const remove = useMutation({
    mutationFn: deleteBackup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });

  async function download(path: string, name: string) {
    setError(null);
    setDownloading(path);
    try { await downloadPortable(path, name); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Download failed."); }
    finally { setDownloading(null); }
  }

  async function onRestore(file: File | undefined) {
    if (!file) return;
    if (inputRef.current) inputRef.current.value = "";
    const confirmed = window.confirm("Replace all tasks, projects, calendar items, docs, sheets, and settings in this account with this backup? This cannot be undone.");
    if (!confirmed) return;
    setError(null); setMessage("Restoring…");
    try {
      const result = await restoreBackup(file);
      await queryClient.invalidateQueries();
      const count = Object.values(result.counts).reduce((sum, value) => sum + value, 0);
      setMessage(`Restore complete. ${count} records loaded.`);
    } catch (cause) {
      setMessage(null);
      setError(cause instanceof Error ? cause.message : "Restore failed.");
    }
  }

  const current: BackupSettings = settings.data ?? { enabled: false, intervalDays: 1, retentionCount: 7 };

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section>
        <h2 className="text-base font-semibold">Data portability</h2>
        <p className="mt-1 text-xs text-muted-foreground">Download an account backup or portable task and calendar files.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <ExportButton icon={Database} label="Full JSON backup" onClick={() => download("/export/full", "timely-backup.json")} busy={downloading === "/export/full"} />
          <ExportButton icon={FileSpreadsheet} label="Tasks CSV" onClick={() => download("/export/tasks.csv", "timely-tasks.csv")} busy={downloading === "/export/tasks.csv"} />
          <ExportButton icon={CalendarDays} label="Calendar ICS" onClick={() => download("/export/calendar.ics", "timely-calendar.ics")} busy={downloading === "/export/calendar.ics"} />
        </div>
      </section>

      <section className="rounded-xl border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Encrypted server backups</h3>
            <p className="mt-1 text-xs text-muted-foreground">Backups are encrypted at rest and old copies are removed using your retention limit.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={current.enabled}
              disabled={settings.isLoading || save.isPending}
              onChange={(event) => save.mutate({ ...current, enabled: event.target.checked })}
            />
            Scheduled
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">Every
            <select aria-label="Backup interval" className="ml-2 rounded-md border border-border bg-background px-2 py-1.5 text-foreground" value={current.intervalDays} onChange={(event) => save.mutate({ ...current, intervalDays: Number(event.target.value) })}>
              {[1, 3, 7, 14, 30].map((days) => <option key={days} value={days}>{days} day{days === 1 ? "" : "s"}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">Keep
            <select aria-label="Backup retention" className="ml-2 rounded-md border border-border bg-background px-2 py-1.5 text-foreground" value={current.retentionCount} onChange={(event) => save.mutate({ ...current, retentionCount: Number(event.target.value) })}>
              {[3, 7, 14, 30].map((count) => <option key={count} value={count}>{count} backups</option>)}
            </select>
          </label>
          <button type="button" onClick={() => create.mutate()} disabled={create.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
            <RefreshCw className={`size-3.5 ${create.isPending ? "animate-spin" : ""}`} /> Create now
          </button>
        </div>
        {current.nextRunAt ? <p className="mt-3 text-xs text-muted-foreground">Next run {new Date(current.nextRunAt).toLocaleString()}</p> : null}
        <ul className="mt-4 space-y-2">
          {(backups.data ?? []).map((backup) => (
            <li key={backup.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-xs">
              <span>{new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.byteSize)}</span>
              <span className="flex gap-1">
                <button aria-label="Download backup" type="button" onClick={() => download(`/backups/${backup.id}`, "timely-backup.json")} className="rounded p-1.5 hover:bg-accent"><Download className="size-3.5" /></button>
                <button aria-label="Delete backup" type="button" onClick={() => window.confirm("Delete this server backup?") && remove.mutate(backup.id)} className="rounded p-1.5 text-destructive hover:bg-destructive/10"><Trash2 className="size-3.5" /></button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Restore</h3>
        <p className="mt-1 text-xs text-muted-foreground">Restore a Timely JSON backup into this account. Your login, devices, API keys, and backup history stay unchanged.</p>
        <input ref={inputRef} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void onRestore(event.target.files?.[0])} />
        <button type="button" onClick={() => inputRef.current?.click()} className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
          <Upload className="size-4" /> Choose backup to restore
        </button>
      </section>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-success">{message}</p> : null}
    </div>
  );
}

function ExportButton({ icon: Icon, label, onClick, busy }: { icon: typeof Database; label: string; onClick: () => void; busy: boolean }) {
  return <button type="button" onClick={onClick} disabled={busy} className="flex items-center gap-2 rounded-lg border border-border px-3 py-3 text-left text-sm hover:bg-muted disabled:opacity-50"><Icon className="size-4 text-primary" />{busy ? "Preparing…" : label}</button>;
}
