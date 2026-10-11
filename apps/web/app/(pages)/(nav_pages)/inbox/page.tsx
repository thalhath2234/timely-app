"use client";

import { FormEvent, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Clock, Inbox } from "lucide-react";
import { inboxAge, inboxQueue, skipInboxItem, type InboxAge } from "@timely/contract/inbox";
import EmptyState from "@/app/_components/_ui/emptyState";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useCaptureInbox, useDeleteTask, useInboxTasks } from "@/app/utils/hooks/tasks";
import { useWorkingHoursZone } from "@/app/utils/hooks/workspaces";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { useTaskContextMenu } from "@/app/utils/hooks/useTaskContextMenu";
import type { Task } from "@/app/_types/types";
import { AnimatePresence, motion } from "motion/react";
import { hoverLift, listContainerVariants, listItemVariants } from "@/app/_components/_ui/motion";
import ScreenTip from "@/app/_components/_ui/screenTip";
import Button, { Kbd } from "@/app/_components/_ui/button";
import PageHeader, { PageBadge } from "@/app/_components/_ui/pageHeader";
import UpNextCard, { type InboxDecision } from "@/app/_components/inbox/upNextCard";
import { cn } from "@/app/utils/cn";

/** "Captured today", "Captured yesterday" or "Waiting 6 days". */
function upNextAge(age: InboxAge) {
  if (age.days === 0) return "Captured today";
  if (age.days === 1) return "Captured yesterday";
  return age.label;
}

export default function InboxPage() {
  const inbox = useInboxTasks();
  const capture = useCaptureInbox();
  const removeTask = useDeleteTask();
  const zone = useWorkingHoursZone();
  const [title, setTitle] = useState("");
  const [capturedFlash, setCapturedFlash] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const captureRef = useRef<HTMLInputElement>(null);
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);
  const setCreateTaskDraft = useSidebarStore((state) => state.setCreateTaskDraft);
  const openMenu = useContextMenu();
  const taskMenu = useTaskContextMenu();
  const items = (inbox.data ?? []) as Task[];
  const { next, rest } = inboxQueue(items, skipped);
  const now = new Date();
  const oldest = items.length > 0 ? inboxAge(inboxQueue(items).next!.createdAt, now, zone) : null;

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

  const review = useCallback(
    (task: Task, kind?: InboxDecision) => {
      setCreateTaskDraft({ name: task.name, inboxId: task.id, ...(kind === "reminder" ? { kind } : {}) });
      setAddNewMode("task");
      setIsAddItemModalOpen(true);
    },
    [setAddNewMode, setCreateTaskDraft, setIsAddItemModalOpen],
  );

  const confirmDelete = useCallback(
    (task: Task) =>
      requestConfirm({
        title: `Delete “${task.name}”?`,
        description: "This cannot be undone.",
        onConfirm: async () => {
          await removeTask.mutateAsync(task.id);
          useToastStore.getState().show("Inbox item deleted");
        },
      }),
    [removeTask],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Inbox"
        bordered
        badge={items.length > 0 ? <PageBadge tone="primary">{items.length} to review</PageBadge> : null}
        actions={
          oldest && oldest.days > 0 ? (
            <span className={cn("flex items-center gap-1.5 text-sm", oldest.stale ? "text-foreground" : "text-muted-foreground")}>
              <Clock className={cn("size-4", oldest.stale ? "text-warning" : "text-muted-foreground")} aria-hidden />
              Oldest waiting {oldest.days} {oldest.days === 1 ? "day" : "days"}
            </span>
          ) : null
        }
      >
        <ScreenTip screen="inbox" className="mt-3" />
      </PageHeader>
      <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5">
        <div className="flex w-full max-w-5xl flex-col gap-6">
          <form
            onSubmit={onCapture}
            className="flex flex-col gap-2 rounded-2xl border border-primary/25 bg-card px-5 pb-3 pt-4 shadow-sm ring-4 ring-primary/[0.06] focus-within:border-primary/50"
          >
            <label htmlFor="inbox-capture" className="text-xs font-medium text-muted-foreground">
              What&apos;s on your mind?
            </label>
            <input
              id="inbox-capture"
              ref={captureRef}
              data-inbox-capture
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Something to follow up…"
              autoComplete="off"
              className="w-full bg-transparent text-xl font-medium tracking-tight text-foreground outline-none placeholder:text-muted-foreground/60"
            />
            <div className="mt-1 flex items-center gap-3 border-t border-border pt-3">
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" role="status">
                {capture.isError ? (
                  <span className="text-destructive">
                    {capture.error instanceof Error ? capture.error.message : "Could not capture."}
                  </span>
                ) : capturedFlash ? (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-medium text-success">
                    Captured. Add the next one.
                  </motion.span>
                ) : (
                  <>Enter to capture. Nothing is scheduled until you decide what it is.</>
                )}
              </p>
              <Button type="submit" disabled={!title.trim()} loading={capture.isPending}>
                Capture
              </Button>
            </div>
          </form>

          {inbox.isError && inbox.data ? (
            <LoadErrorBanner what="inbox" error={inbox.error} onRetry={() => inbox.refetch()} retrying={inbox.isFetching} />
          ) : null}
          {inbox.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading inbox…</p>
          ) : inbox.isError && !inbox.data ? (
            <LoadError what="inbox" error={inbox.error} onRetry={() => inbox.refetch()} retrying={inbox.isFetching} />
          ) : !next ? (
            <EmptyState
              icon={Inbox}
              title="Inbox zero"
              description="Nothing is waiting for a decision. Capture anything above, or press N anywhere to create a full task."
            />
          ) : (
            <>
              <section aria-labelledby="inbox-up-next" className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id="inbox-up-next" className="text-sm font-semibold text-foreground">
                    Up next
                  </h2>
                  <p className="text-xs text-muted-foreground">Oldest first. Decide, or put it off for later.</p>
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  <UpNextCard
                    key={next.id}
                    task={next}
                    age={inboxAge(next.createdAt, now, zone)}
                    ageLabel={upNextAge(inboxAge(next.createdAt, now, zone))}
                    canSkip={rest.length > 0}
                    onDecide={(kind) => review(next, kind)}
                    onSkip={() => setSkipped((current) => skipInboxItem(items, current, next.id))}
                    onDelete={() => confirmDelete(next)}
                  />
                </AnimatePresence>
              </section>

              {rest.length > 0 ? (
                <section aria-labelledby="inbox-rest" className="flex flex-col gap-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 id="inbox-rest" className="text-sm font-semibold text-foreground">
                      Also waiting <span className="font-normal tabular-nums text-muted-foreground">{rest.length}</span>
                    </h2>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Press <Kbd className="opacity-100">C</Kbd> to capture
                    </p>
                  </div>
                  <motion.ul
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                    variants={listContainerVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    <AnimatePresence initial={false}>
                      {rest.map((task) => {
                        const age = inboxAge(task.createdAt, now, zone);
                        return (
                          <motion.li
                            key={task.id}
                            variants={listItemVariants}
                            layout
                            exit={{ opacity: 0, scale: 0.97 }}
                          >
                            <motion.button
                              type="button"
                              whileHover={hoverLift}
                              whileTap={{ scale: 0.99 }}
                              onClick={() => review(task)}
                              onContextMenu={(event) => openMenu(event, taskMenu(task), { title: task.name })}
                              className={cn(
                                "group flex h-full min-h-28 w-full flex-col gap-1.5 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/30",
                                age.stale ? "border-warning/40 bg-warning/[0.04]" : "border-border",
                              )}
                            >
                              <span
                                className={cn(
                                  "flex items-center gap-1.5 text-xs font-medium",
                                  age.days === 0 ? "text-success" : "text-muted-foreground",
                                  age.stale && "text-foreground",
                                )}
                              >
                                {age.stale ? <span className="size-1.5 rounded-full bg-warning" aria-hidden /> : null}
                                {age.days === 0 ? "New today" : age.label}
                              </span>
                              <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
                                {task.name}
                              </span>
                              {task.description ? (
                                <span className="line-clamp-2 text-sm text-muted-foreground">{task.description}</span>
                              ) : null}
                              <span className="mt-auto pt-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                Review
                              </span>
                            </motion.button>
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </motion.ul>
                </section>
              ) : null}
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Need the full task list?{" "}
            <Link href="/tasks" className="text-primary hover:underline">
              Open tasks
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
