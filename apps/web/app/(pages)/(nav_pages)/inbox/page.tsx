"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import EmptyState from "@/app/_components/_ui/emptyState";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useCaptureInbox, useInboxTasks } from "@/app/utils/hooks/tasks";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useTaskContextMenu } from "@/app/utils/hooks/useTaskContextMenu";
import type { Task } from "@/app/_types/types";
import { AnimatePresence, motion } from "motion/react";
import { hoverLift, listContainerVariants, listItemVariants } from "@/app/_components/_ui/motion";
import ScreenTip from "@/app/_components/_ui/screenTip";
import Button from "@/app/_components/_ui/button";
import { Input } from "@/app/_components/_ui/field";
import PageHeader, { PageBadge } from "@/app/_components/_ui/pageHeader";

export default function InboxPage() {
  const inbox = useInboxTasks();
  const capture = useCaptureInbox();
  const [title, setTitle] = useState("");
  const [capturedFlash, setCapturedFlash] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);
  const setCreateTaskDraft = useSidebarStore((state) => state.setCreateTaskDraft);
  const openMenu = useContextMenu();
  const taskMenu = useTaskContextMenu();
  const items = (inbox.data ?? []) as Task[];

  const onCapture = (event: FormEvent) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    void capture.mutateAsync(name).then(() => {
      setTitle("");
      setCapturedFlash(true);
      captureRef.current?.focus();
      window.setTimeout(() => setCapturedFlash(false), 1400);
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Inbox"
        bordered
        badge={items.length > 0 ? <PageBadge tone="primary">{items.length} to review</PageBadge> : null}
        description="Capture a title now. Assign a workspace to make it work, or turn it into a reminder when you review."
      >
        <ScreenTip screen="inbox" className="mt-3" />
        <form onSubmit={onCapture} className="mt-4 flex max-w-3xl gap-2">
          <Input
            ref={captureRef}
            data-inbox-capture
            size="lg"
            aria-label="Capture to inbox"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Something to follow up…"
          />
          <Button type="submit" size="lg" disabled={!title.trim()} loading={capture.isPending}>
            Capture
          </Button>
        </form>
        {capturedFlash ? (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 text-sm text-success"
            role="status"
          >
            Captured
          </motion.p>
        ) : null}
        {capture.isError ? (
          <p className="mt-2 text-sm text-destructive" role="status">
            {capture.error instanceof Error ? capture.error.message : "Could not capture."}
          </p>
        ) : null}
      </PageHeader>
      <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5">
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
          <motion.ul
            className="space-y-2"
            variants={listContainerVariants}
            initial="hidden"
            animate="visible"
          >
            <AnimatePresence initial={false}>
            {items.map((task) => (
              <motion.li key={task.id} variants={listItemVariants} layout exit={{ opacity: 0, y: -6 }}>
                <motion.button
                  type="button"
                  whileHover={hoverLift}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => {
                    setCreateTaskDraft({ name: task.name, inboxId: task.id });
                    setAddNewMode("task");
                    setIsAddItemModalOpen(true);
                  }}
                  onContextMenu={(event) =>
                    openMenu(event, taskMenu(task), { title: task.name })
                  }
                  className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/30 hover:bg-accent/40"
                >
                  <span className="truncate">{task.name}</span>
                  <span className="text-xs font-medium text-primary group-hover:underline">Review</span>
                </motion.button>
              </motion.li>
            ))}
            </AnimatePresence>
          </motion.ul>
        )}
        <p className="mt-6 text-xs text-muted-foreground">
          Need the full task list?{" "}
          <Link href="/tasks" className="text-primary hover:underline">
            Open tasks
          </Link>
        </p>
      </div>
    </div>
  );
}
