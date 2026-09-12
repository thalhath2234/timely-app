"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import EmptyState from "@/app/_components/_ui/emptyState";
import EntityDetailPanel from "@/app/_components/_ui/tasks/entityDetailPanel";
import { useCreateTask, useInboxTasks } from "@/app/utils/hooks/tasks";
import type { Task } from "@/app/_types/types";

export default function InboxPage() {
  const inbox = useInboxTasks();
  const capture = useCreateTask();
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const items = (inbox.data ?? []) as Task[];

  const onCapture = (event: FormEvent) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    void capture.mutateAsync({ name, kind: "inbox" }).then(() => setTitle(""));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Capture a title now. Assign workspace, duration, and schedule when you review.
        </p>
        <form onSubmit={onCapture} className="mt-3 flex gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Something to follow up…"
            className="flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={!title.trim() || capture.isPending}
            className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            Capture
          </button>
        </form>
        {capture.isError ? (
          <p className="mt-2 text-sm text-destructive">
            {capture.error instanceof Error ? capture.error.message : "Could not capture."}
          </p>
        ) : null}
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        {inbox.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading inbox…</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Inbox is empty"
            description="Press C or use capture above. Inbox items are never auto-scheduled."
          />
        ) : (
          <ul className="space-y-2">
            {items.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(task.id)}
                  className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-accent/40"
                >
                  <span className="truncate">{task.name}</span>
                  <span className="text-xs text-muted-foreground">Review</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-xs text-muted-foreground">
          Need the full task list?{" "}
          <Link href="/tasks" className="underline">
            Open tasks
          </Link>
        </p>
      </div>
      {openId ? (
        <EntityDetailPanel kind="task" id={openId} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}
