"use client";

import { FormEvent, useRef, useState } from "react";
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
  const [capturedFlash, setCapturedFlash] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);
  const openTask = useEntityDetailStore((state) => state.openTask);
  const items = (inbox.data ?? []) as Task[];

  const onCapture = (event: FormEvent) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    void capture.mutateAsync({ name, kind: "inbox" }).then(() => {
      setTitle("");
      setCapturedFlash(true);
      captureRef.current?.focus();
      window.setTimeout(() => setCapturedFlash(false), 1400);
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-border px-6 py-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          {items.length > 0 ? (
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-medium tracking-wider text-primary uppercase">
              {items.length} unreviewed
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Capture a title now. Assign a workspace to make it work, or turn it into a reminder when you review.
        </p>
        <form onSubmit={onCapture} className="mt-4 flex gap-2">
          <input
            ref={captureRef}
            data-inbox-capture
            aria-label="Capture to inbox"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Something to follow up…"
            className="h-11 flex-1 rounded-lg border border-border bg-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={!title.trim() || capture.isPending}
            className="h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Capture
          </button>
        </form>
        {capturedFlash ? (
          <p className="mt-2 text-sm text-success" role="status">
            Captured
          </p>
        ) : null}
        {capture.isError ? (
          <p className="mt-2 text-sm text-destructive" role="status">
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
                  className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm transition hover:bg-accent"
                >
                  <span className="truncate">{task.name}</span>
                  <span className="text-xs font-medium text-primary">Review</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-xs text-muted-foreground">
          Need the full task list?{" "}
          <Link href="/tasks" className="text-primary underline">
            Open tasks
          </Link>
        </p>
      </div>
    </div>
  );
}
