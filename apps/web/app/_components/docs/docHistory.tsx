"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, RotateCcw, X } from "lucide-react";
import { DOC_VERSION_REASONS } from "@timely/contract/documents";
import RichTextEditor from "@/app/_components/editor/richTextEditor";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { getDocVersion, getDocVersions, restoreDocVersion } from "@/app/utils/api/docs";
import { docKey } from "@/app/utils/hooks/docs";
import { resolveDocContent } from "@/app/utils/markdown";
import { useToastStore } from "@/app/_store/toastStore";
import type { Doc } from "@/app/_types/types";

function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/**
 * Version history: saved states of the doc, newest first, with a read-only
 * preview and Restore. `beforeRestore` saves pending typing first; the
 * restored doc is handed to `onRestored` so the page can show it.
 */
export default function DocHistory({
  docId,
  onClose,
  beforeRestore,
  onRestored,
}: {
  docId: string;
  onClose: () => void;
  beforeRestore: () => Promise<unknown>;
  onRestored: (doc: Doc) => void;
}) {
  const versions = useQuery({ queryKey: [...docKey(docId), "versions"], queryFn: () => getDocVersions(docId) });
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? versions.data?.[0]?.id ?? null;
  const version = useQuery({
    queryKey: [...docKey(docId), "versions", activeId],
    queryFn: () => getDocVersion(docId, activeId as string),
    enabled: Boolean(activeId),
    staleTime: Infinity,
  });
  const [restoring, setRestoring] = useState(false);

  const restore = async () => {
    if (!activeId) return;
    setRestoring(true);
    try {
      await beforeRestore();
      const doc = await restoreDocVersion(docId, activeId);
      onRestored(doc);
      useToastStore.getState().show("Version restored. The doc as it was is in the history too.");
      onClose();
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not restore this version");
    } finally {
      setRestoring(false);
    }
  };

  const items = (versions.data ?? []).map((item, index, all) => {
    const edited = new Date(item.editedAt);
    const day = dayLabel(edited);
    return { item, edited, day, showDay: index === 0 || dayLabel(new Date(all[index - 1].editedAt)) !== day };
  });

  return (
    <>
      <OverlayScrim className="z-50" onClick={onClose} />
      <OverlayFrame className="z-50 items-stretch justify-center p-6">
        <OverlayPanel
          role="dialog"
          aria-label="Version history"
          className="flex w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3">
              <History className="size-4 text-muted-foreground" />
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
                {version.data ? version.data.title || "Untitled" : "Version history"}
              </h2>
              <button
                type="button"
                disabled={!activeId || restoring || !version.data}
                onClick={() => void restore()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" />
                {restoring ? "Restoring…" : "Restore this version"}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-10 py-6">
              {versions.data?.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No earlier versions yet. Timely saves one when you start editing again after a pause, every hour while
                  you keep editing, and before the assistant changes this doc.
                </p>
              ) : version.data?.content ? (
                <RichTextEditor
                  key={version.data.id}
                  editable={false}
                  content={resolveDocContent(version.data.content, version.data.plainText)}
                  onChange={() => undefined}
                  enableSlashCommands={false}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}
            </div>
          </div>
          <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-muted/20">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">History</span>
              <button
                type="button"
                aria-label="Close history"
                onClick={onClose}
                className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent"
              >
                <X className="size-4" />
              </button>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {items.map(({ item, edited, day, showDay }) => {
                return (
                  <li key={item.id}>
                    {showDay && <p className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">{day}</p>}
                    <button
                      type="button"
                      onClick={() => setSelected(item.id)}
                      aria-current={item.id === activeId}
                      className={`w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent ${
                        item.id === activeId ? "bg-accent text-accent-foreground" : ""
                      }`}
                    >
                      <span className="block text-sm font-medium">
                        {edited.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {DOC_VERSION_REASONS[item.reason] ?? "Saved"} · {item.words} {item.words === 1 ? "word" : "words"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        </OverlayPanel>
      </OverlayFrame>
    </>
  );
}
