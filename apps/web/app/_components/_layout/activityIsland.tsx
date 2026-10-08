"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { CalendarClock, Pause, Play, Sparkles, Square, Timer, X } from "lucide-react";
import { formatClock } from "@timely/contract/dashboard";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { useClientGate } from "@/app/_components/_ui/motion";
import { useChatStore } from "@/app/_store/chatStore";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { useScheduleActivityStore } from "@/app/_store/scheduleActivityStore";
import {
  bindPomodoroQueryClient,
  pomodoroTimeLeft,
  selectActivePomodoros,
  usePomodoroStore,
  type PomodoroTimer,
} from "@/app/_store/pomodoroStore";
import { chatRequest, type Chat, type ChatSummary } from "@/app/utils/api/chat";
import { chatKey, chatsKey, useChats } from "@/app/utils/hooks/chat";
import { useToday } from "@/app/utils/hooks/calendar";
import { useStopFocus } from "@/app/utils/hooks/tasks";
import { prefersReducedMotion } from "@/app/utils/viewTransition";
import {
  isBusy,
  phaseLabel,
  statusMeta,
} from "@/app/_components/chat/chatMeta";
import { cn } from "@/app/utils/cn";

/** Underdamped so the island overshoots a little when it opens and closes. */
const islandSpring = {
  type: "spring",
  stiffness: 380,
  damping: 22,
  mass: 0.9,
} as const;

/** Shared `view-transition-name` for the quick prompt shrinking into the pill. */
export const ISLAND_MORPH = "activity-island";

// Set while the quick prompt morphs into the pill, so the pill mounts in
// place instead of running its own entrance under the view transition.
let morphing = false;

/**
 * Closes the quick prompt into the Activity island with a view transition:
 * the prompt holds the shared name for the old snapshot and the pill takes it
 * for the new one (a name held twice aborts the transition).
 */
export function morphIntoIsland(from: HTMLElement | null, update: () => void) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };
  if (!from || !doc.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }
  from.style.viewTransitionName = ISLAND_MORPH;
  morphing = true;
  const transition = doc.startViewTransition(() => {
    flushSync(update);
    const pill = document.querySelector<HTMLElement>("[data-activity-island]");
    if (pill) pill.style.viewTransitionName = ISLAND_MORPH;
  });
  void transition.finished.finally(() => {
    morphing = false;
    document
      .querySelector<HTMLElement>("[data-activity-island]")
      ?.style.removeProperty("view-transition-name");
  });
}

type ChatItem = Pick<
  ChatSummary,
  "id" | "title" | "status" | "phase" | "revision"
>;

function elapsedLabel(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}h${String(m).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const POMODORO_PHASE = { focus: "Focus", short: "Short break", long: "Long break" } as const;

function pomodoroDetail(timer: PomodoroTimer, now: number) {
  const left = `${formatClock(pomodoroTimeLeft(timer, now))} left`;
  return timer.endsAt === null
    ? `Paused · ${left}`
    : `${POMODORO_PHASE[timer.phase]} · ${left}`;
}

/**
 * The Activity island: a pill above Sign out that tracks what is running —
 * Agent runs, the Work being focused, Report pomodoro timers and
 * Auto-schedule. It opens into a list and bounces when an Agent run finishes.
 */
export default function ActivityIsland() {
  const { tracked, dismissed, untrack, openChat } = useChatStore();
  const dismissChat = useChatStore((s) => s.dismiss);
  const openTask = useEntityDetailStore((s) => s.openTask);
  const schedule = useScheduleActivityStore();
  const { data: chats } = useChats();
  const today = useToday();
  const stopFocus = useStopFocus();
  const cache = useQueryClient();
  const router = useRouter();
  // Timers are saved in this browser, so the server render has none.
  const mounted = useClientGate();
  const storedPomodoros = usePomodoroStore(useShallow(selectActivePomodoros));
  const pomodoros = mounted ? storedPomodoros : [];
  const [open, setOpen] = useState(false);
  const [attention, setAttention] = useState(false);
  const [bounces, setBounces] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [scope, animate] = useAnimate();
  const wrap = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // Keyboard closes (Esc, Close) hand focus back to the pill; a click
  // elsewhere leaves it where the person clicked.
  const refocusPill = useRef(false);

  const focusTask = today.data?.focusing ?? null;
  // A pomodoro linked to the focused task already shows it, with its own Stop.
  const focusing =
    focusTask &&
    pomodoros.some((t) => t.endsAt !== null && t.taskId === focusTask.id)
      ? null
      : focusTask;
  const scheduling = schedule.status === "running";
  const timing = Boolean(focusing) || pomodoros.some((t) => t.endsAt !== null);

  useEffect(() => {
    bindPomodoroQueryClient(cache);
  }, [cache]);

  const chatItems = useMemo(() => {
    const byId = new Map((chats ?? []).map((c) => [c.id, c]));
    const items: ChatItem[] = tracked.map(
      (id) =>
        byId.get(id) ??
        cache.getQueryData<Chat>(chatKey(id)) ?? {
          id,
          title: "New chat",
          status: "queued",
          phase: "",
          revision: 0,
        },
    );
    for (const c of chats ?? [])
      if (
        !tracked.includes(c.id) &&
        dismissed[c.id] !== c.revision &&
        (isBusy(c.status) || c.status === "approval" || c.unread)
      )
        items.push(c);
    return items;
  }, [chats, tracked, dismissed, cache]);

  const count =
    chatItems.length +
    (focusing ? 1 : 0) +
    pomodoros.length +
    (scheduling ? 1 : 0);
  const expanded = open && count > 0;
  const anyBusy = chatItems.some((c) => isBusy(c.status));

  // An Agent run that stops working (or a sent chat first seen already done)
  // gets the person's attention. The first poll only records what is there.
  const busyKey = chatItems
    .map((c) => `${c.id}:${isBusy(c.status) ? 1 : 0}`)
    .join(",");
  const [lastBusyKey, setLastBusyKey] = useState<string | null>(null);
  if (chats && busyKey !== lastBusyKey) {
    setLastBusyKey(busyKey);
    if (lastBusyKey !== null) {
      const previous = new Map(
        lastBusyKey
          .split(",")
          .filter(Boolean)
          .map((entry) => {
            const at = entry.lastIndexOf(":");
            return [entry.slice(0, at), entry.slice(at + 1) === "1"] as const;
          }),
      );
      const finished = chatItems.some(
        (c) =>
          !isBusy(c.status) &&
          (previous.get(c.id) ??
            (tracked.includes(c.id) && !previous.has(c.id))),
      );
      if (finished) {
        setAttention(true);
        setBounces((n) => n + 1);
      }
    }
  }

  useEffect(() => {
    if (!bounces || !scope.current || prefersReducedMotion()) return;
    void animate(
      scope.current,
      { y: [0, -10, 0, -5, 0], scale: [1, 1.12, 0.98, 1.05, 1] },
      { duration: 0.8, ease: "easeOut" },
    );
  }, [bounces, animate, scope]);

  useEffect(() => {
    if (!timing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [timing]);

  function closeIsland(restoreFocus: boolean) {
    refocusPill.current = restoreFocus;
    setOpen(false);
  }

  useEffect(() => {
    if (expanded) {
      closeButton.current?.focus({ preventScroll: true });
      return;
    }
    if (!refocusPill.current) return;
    refocusPill.current = false;
    wrap.current
      ?.querySelector<HTMLElement>("[data-activity-island]")
      ?.focus({ preventScroll: true });
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    function onDown(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) closeIsland(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeIsland(true);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  const started = focusing?.focusStartedAt
    ? new Date(focusing.focusStartedAt).getTime()
    : NaN;
  const elapsed = Number.isNaN(started)
    ? 0
    : Math.max(0, Math.floor((now - started) / 1000));

  function openFromIsland(id: string) {
    setOpen(false);
    untrack(id);
    openChat(id);
  }

  function dismiss(c: ChatItem) {
    const id = c.id;
    dismissChat(id, c.revision);
    void chatRequest(`/${encodeURIComponent(id)}/read`, "POST").then(() =>
      cache.invalidateQueries({ queryKey: chatsKey }),
    );
  }

  const pillIcons = [
    anyBusy ? "busy" : chatItems.length ? "chat" : null,
    focusing ? "focus" : null,
    pomodoros.length ? "pomodoro" : null,
    scheduling ? "schedule" : null,
  ].filter(Boolean) as ("busy" | "chat" | "focus" | "pomodoro" | "schedule")[];
  const lonePomodoro =
    pillIcons.length === 1 && pomodoros.length === 1 ? pomodoros[0] : null;

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          key="activity-island"
          ref={wrap}
          initial={morphing ? false : { opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={islandSpring}
          className="relative mt-auto mb-1"
        >
          <div ref={scope}>
            {expanded ? (
              <div className="h-7 w-[52px]" />
            ) : (
              <motion.button
                type="button"
                layoutId="activity-island-shell"
                data-activity-island=""
                aria-label={`Activity: ${count} in progress`}
                aria-expanded={false}
                aria-haspopup="dialog"
                title="Activity"
                onClick={() => {
                  setOpen(true);
                  setAttention(false);
                }}
                style={{ borderRadius: 999 }}
                transition={islandSpring}
                className="flex h-7 w-[52px] cursor-pointer items-center justify-center gap-1 border border-border bg-popover text-popover-foreground shadow-md"
              >
                {pillIcons
                  .slice(0, 2)
                  .map((kind) =>
                    kind === "busy" ? (
                      <LogoSpinner key={kind} size={16} label="Agent working" />
                    ) : kind === "chat" ? (
                      <Sparkles key={kind} className="size-3.5 text-primary" />
                    ) : kind === "focus" ? (
                      <Timer key={kind} className="size-3.5 text-success" />
                    ) : kind === "pomodoro" ? (
                      <Timer key={kind} className="size-3.5 text-primary" />
                    ) : (
                      <CalendarClock key={kind} className="size-3.5" />
                    ),
                  )}
                {pillIcons.length === 1 && focusing && (
                  <span className="text-[10px] font-medium tabular-nums">
                    {elapsedLabel(elapsed)}
                  </span>
                )}
                {lonePomodoro && (
                  <span className="text-[10px] font-medium tabular-nums">
                    {formatClock(pomodoroTimeLeft(lonePomodoro, now))}
                  </span>
                )}
              </motion.button>
            )}
          </div>
          {attention && !expanded && (
            <span
              aria-hidden
              data-activity-attention=""
              className="pointer-events-none absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-sidebar"
            />
          )}
          <AnimatePresence>
            {expanded && (
              <motion.div
                layoutId="activity-island-shell"
                role="dialog"
                aria-label="Activity"
                style={{ borderRadius: 22 }}
                transition={islandSpring}
                className="absolute bottom-0 left-0 z-50 w-[300px] overflow-hidden border border-border bg-popover text-popover-foreground shadow-2xl"
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.08 } }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  className="p-2"
                >
                  <div className="flex items-center justify-between px-2 pb-1 pt-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Activity
                    </p>
                    <button
                      type="button"
                      ref={closeButton}
                      aria-label="Close activity"
                      onClick={() => closeIsland(true)}
                      className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <ul className="space-y-0.5">
                    {chatItems.map((c) => {
                      const busy = isBusy(c.status);
                      const meta = statusMeta(c.status);
                      const Icon = meta.icon;
                      return (
                        <li
                          key={c.id}
                          className="flex items-center rounded-2xl hover:bg-accent"
                        >
                          <button
                            type="button"
                            onClick={() => openFromIsland(c.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2 text-left"
                          >
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                              {busy ? (
                                <LogoSpinner size={16} label={meta.label} />
                              ) : (
                                <Icon
                                  className={cn(
                                    "size-4",
                                    meta.tone === "warning"
                                      ? "text-warning"
                                      : meta.tone === "destructive"
                                        ? "text-destructive"
                                        : "text-primary",
                                  )}
                                />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {c.title || "New chat"}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {busy
                                  ? phaseLabel(c.phase)
                                  : c.status === "idle"
                                    ? "Replied · open to read"
                                    : meta.label}
                              </span>
                            </span>
                          </button>
                          {!busy && (
                            <button
                              type="button"
                              aria-label={`Dismiss ${c.title || "chat"}`}
                              onClick={() => dismiss(c)}
                              className="mr-2 shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                    {focusing && (
                      <li className="flex items-center rounded-2xl hover:bg-accent">
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            openTask(focusing.id);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2 text-left"
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                            <Timer className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {focusing.name}
                            </span>
                            <span className="block text-xs tabular-nums text-muted-foreground">
                              Focusing · {elapsedLabel(elapsed)}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label="Stop focus"
                          disabled={stopFocus.isPending}
                          onClick={() => stopFocus.mutate(focusing.id)}
                          className="mr-2 shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40"
                        >
                          <Square className="size-3.5 fill-current" />
                        </button>
                      </li>
                    )}
                    {pomodoros.map((timer) => {
                      const running = timer.endsAt !== null;
                      const actions = usePomodoroStore.getState();
                      return (
                        <li
                          key={timer.cardId}
                          className="flex items-center rounded-2xl hover:bg-accent"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              router.push("/report");
                            }}
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2 text-left"
                          >
                            <span
                              className={cn(
                                "flex size-8 shrink-0 items-center justify-center rounded-full",
                                timer.phase === "focus"
                                  ? "bg-primary/15 text-primary"
                                  : "bg-success/15 text-success",
                              )}
                            >
                              <Timer className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {timer.taskName || "Pomodoro"}
                              </span>
                              <span className="block text-xs tabular-nums text-muted-foreground">
                                {pomodoroDetail(timer, now)}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label={running ? "Pause pomodoro" : "Resume pomodoro"}
                            onClick={() => {
                              setNow(Date.now());
                              if (running) actions.pause(timer.cardId);
                              else actions.start(timer.cardId);
                            }}
                            className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
                          >
                            {running ? (
                              <Pause className="size-3.5 fill-current" />
                            ) : (
                              <Play className="size-3.5 fill-current" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label="Stop pomodoro"
                            onClick={() => actions.reset(timer.cardId)}
                            className="mr-2 shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
                          >
                            <Square className="size-3.5 fill-current" />
                          </button>
                        </li>
                      );
                    })}
                    {scheduling && (
                      <li className="flex items-center gap-3 px-2 py-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                          <LogoSpinner size={16} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {schedule.message || "Auto-scheduling…"}
                        </span>
                      </li>
                    )}
                  </ul>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
