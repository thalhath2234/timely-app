"use client";

import { SkeletonRows } from "@/app/_components/_ui/skeleton";
import { FormEvent, useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
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
import { listContainerVariants, listItemVariants } from "@/app/_components/_ui/motion";
import ScreenTip from "@/app/_components/_ui/screenTip";
import Button from "@/app/_components/_ui/button";
import PageHeader, { PageBadge } from "@/app/_components/_ui/pageHeader";
import UpNextCard, { type InboxDecision } from "@/app/_components/inbox/upNextCard";
import InboxStats from "@/app/_components/inbox/inboxStats";
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
  const ages = items.map((item) => inboxAge(item.createdAt, now, zone));

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
      setCreateTaskDraft({ name: task.name, inboxId: task.id, ...(kind ? { kind } : {}) });
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

  const summary = !inbox.isLoading && !(inbox.isError && !inbox.data);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Inbox"
        bordered
        badge={items.length > 0 ? <PageBadge tone="primary">{items.length} to review</PageBadge> : null}
      >
        <ScreenTip screen="inbox" className="mt-3" />
      </PageHeader>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="flex w-full max-w-[1320px] flex-col gap-4">
          <form onSubmit={onCapture} className="flex flex-col gap-1.5" data-testid="inbox-capture">
            <div className="flex items-center gap-2.5">
              <label htmlFor="inbox-capture" className="sr-only">
                What&apos;s on your mind?
              </label>
              <input
                id="inbox-capture"
                ref={captureRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Something to follow up…"
                autoComplete="off"
                className="h-10 min-w-0 flex-1 rounded-[10px] border border-border bg-card px-3.5 text-[15px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-primary focus:ring-[3px] focus:ring-primary/20"
              />
              <Button type="submit" size="lg" disabled={!title.trim()} loading={capture.isPending}>
                Capture
              </Button>
            </div>
            <p className="min-w-0 truncate px-1 text-xs text-muted-foreground" role="status">
              {capture.isError ? (
                <span className="text-destructive">{capture.error instanceof Error ? capture.error.message : "Could not capture."}</span>
              ) : capturedFlash ? (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-medium text-success">
                  Captured. Add the next one.
                </motion.span>
              ) : (
                <>Enter to capture. Nothing is scheduled until you decide what it is.</>
              )}
            </p>
          </form>

          {inbox.isError && inbox.data ? (
            <LoadErrorBanner what="inbox" error={inbox.error} onRetry={() => inbox.refetch()} retrying={inbox.isFetching} />
          ) : null}
          {inbox.isLoading ? (
            <SkeletonRows rows={5} height={46} />
          ) : inbox.isError && !inbox.data ? (
            <LoadError what="inbox" error={inbox.error} onRetry={() => inbox.refetch()} retrying={inbox.isFetching} />
          ) : !next ? (
            <EmptyState icon={Inbox} title="Inbox zero" description="Nothing is waiting for a decision. Capture anything above and decide later." />
          ) : (
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
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
              <section aria-labelledby="inbox-rest" className="overflow-hidden rounded-[12px] border border-border bg-card" data-testid="inbox-list">
                <h2 id="inbox-rest" className="sr-only">
                  Also waiting
                </h2>
                {rest.length > 0 ? (
                  <motion.ul variants={listContainerVariants} initial="hidden" animate="visible">
                    <AnimatePresence initial={false}>
                      {rest.map((task, index) => {
                        const age = inboxAge(task.createdAt, now, zone);
                        return (
                          <motion.li
                            key={task.id}
                            variants={listItemVariants}
                            layout
                            exit={{ opacity: 0 }}
                            className={cn("group relative", index > 0 && "border-t border-border")}
                          >
                            <button
                              type="button"
                              onClick={() => review(task)}
                              onContextMenu={(event) => openMenu(event, taskMenu(task), { title: task.name })}
                              className="flex h-[46px] w-full items-center gap-3 px-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40"
                            >
                              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{task.name}</span>
                              {task.description ? (
                                <span className="hidden max-w-[32%] truncate text-xs text-muted-foreground xl:inline">{task.description}</span>
                              ) : null}
                              {age.days === 0 ? (
                                <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-success">New</span>
                              ) : age.stale ? (
                                <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-warning">
                                  {age.days} days
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">{age.label}</span>
                              )}
                              <span className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-foreground">
                                Review
                              </span>
                            </button>
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </motion.ul>
                ) : (
                  <p className="px-4 py-3 text-sm text-muted-foreground">Nothing else is waiting.</p>
                )}
                <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                  Need the full task list?{" "}
                  <Link href="/tasks" className="text-primary hover:underline">
                    Open tasks
                  </Link>
                </p>
              </section>
            </div>
          )}
          {summary ? (
            <InboxStats
              fresh={ages.filter((age) => age.days === 0).length}
              recent={ages.filter((age) => age.days > 0 && !age.stale).length}
              stale={ages.filter((age) => age.stale).length}
              oldestDays={oldest?.days ?? 0}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
