"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import EmptyState from "@/app/_components/_ui/emptyState";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { useCreateTask, useInboxTasks } from "@/app/utils/hooks/tasks";
import type { Task } from "@/app/_types/types";

export default function InboxPage() {
  const inbox = useInboxTasks();
  const capture = useCreateTask();
  const [title, setTitle] = useState("");
  const openTask = useEntityDetailStore((state) => state.openTask);
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
          Capture a title now. Assign a workspace to make it work, or turn it into a reminder when you review.
        </p>
        <form onSubmit={onCapture} className="mt-3 flex gap-2">
          <input
            data-inbox-capture
            aria-label="Capture to inbox"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Something to follow up…"
            className="flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/40"
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
      <div className="flex flex-1 flex-col overflow-y-auto p-6">
        {inbox.isError && inbox.data ? (
          <LoadErrorBanner
            what="inbox"
            error={inbox.error}
            onRetry={() => inbox.refetch()}
            retrying={inbox.isFetching}
            className="mb-4"
          />
        ) : null}
        {inbox.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading inbox…</p>
        ) : inbox.isError && !inbox.data ? (
          <LoadError
            what="inbox"
            error={inbox.error}
            onRetry={() => inbox.refetch()}
            retrying={inbox.isFetching}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Inbox is empty"
            description="Press C here to capture a title, or N anywhere to create a full task. Inbox items are never auto-scheduled."
          />
        ) : (
          <ul className="space-y-2">
            {items.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => openTask(task.id)}
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
    </div>
  );
}
