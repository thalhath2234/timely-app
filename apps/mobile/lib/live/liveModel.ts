/**
 * What the phone's live notification says: the same things the desktop
 * Activity island tracks (Agent runs, the task in focus, pomodoro timers,
 * Auto-schedule), boiled down to one ongoing notification. Pure so
 * `make test-mobile-live-activity` can run it under Node.
 */

export type LiveChat = { id: string; title: string; status: string; phase?: string };
export type LiveFocus = { id: string; name: string; focusStartedAt?: string | null; focusPausedAt?: string | null };
export type LivePomodoro = {
  cardId: string;
  phase: "focus" | "short" | "long";
  /** Epoch ms the phase ends; null while paused. */
  endsAt: number | null;
  /** Milliseconds left (frozen while paused). */
  leftMs: number;
  /** The phase's full length in ms, for the progress bar. */
  totalMs?: number;
  taskId?: string | null;
  taskName?: string | null;
};

export type LiveInput = {
  now: number;
  chats: LiveChat[];
  focusing: LiveFocus | null;
  pomodoros: LivePomodoro[];
  scheduling: boolean;
  /** Deep link scheme, e.g. "timelymobile". */
  scheme: string;
};

export type LiveButtonModel = { id: string; label: string; uri?: string; data?: Record<string, unknown> };

export type LiveModel = {
  title: string;
  text: string;
  bigText?: string;
  subText?: string;
  chip?: string;
  chronometer?: { base: number; countDown?: boolean };
  progress?: { max: number; value: number; indeterminate?: boolean };
  uri: string;
  accent: string;
  actions: LiveButtonModel[];
};

/** Live notification button ids handled in lib/live/liveActivity.ts. */
export const LIVE_ACTIONS = {
  stopFocus: "stopFocus",
  pausePomodoro: "pausePomodoro",
  resumePomodoro: "resumePomodoro",
  skipPomodoro: "skipPomodoro",
  stopRun: "stopRun",
} as const;

const ACCENT = "#8b7cf7";
const PHASE_LABEL = { focus: "Focus", short: "Short break", long: "Long break" } as const;

export function isBusyChat(status?: string) {
  return status === "queued" || status === "running";
}

function chatPhase(chat: LiveChat) {
  if (chat.status === "queued") return "Queued";
  switch (chat.phase) {
    case "apply":
      return "Saving your changes…";
    case "extract":
      return "Reading your images…";
    case "receipt_edit":
      return "Revising your receipt…";
    case "receipt_plan":
      return "Refreshing the receipt proposal…";
    default:
      return "Thinking it through…";
  }
}

/** "4:05" or "1:02:05". */
export function clock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function chatUri(scheme: string, id: string) {
  return `${scheme}://assistant?chatId=${encodeURIComponent(id)}`;
}

type Item = { line: string; build: () => Omit<LiveModel, "subText" | "bigText" | "accent"> };

/** The live notification for what is running now, or null when nothing is. */
export function liveModel(input: LiveInput): LiveModel | null {
  const { now, scheme } = input;
  const busy = input.chats.filter((chat) => isBusyChat(chat.status));
  // A pomodoro linked to the focused task already shows it, as on the island.
  const focusing =
    input.focusing && input.pomodoros.some((t) => t.endsAt !== null && t.taskId === input.focusing?.id)
      ? null
      : input.focusing;
  const items: Item[] = [];

  for (const chat of busy) {
    items.push({
      line: `Assistant · ${chat.title || "New chat"} · ${chatPhase(chat)}`,
      build: () => ({
        title: chat.title || "Assistant is working",
        text: chatPhase(chat),
        chip: "Working",
        progress: { max: 0, value: 0, indeterminate: true },
        uri: chatUri(scheme, chat.id),
        actions: [
          { id: "open", label: "Open chat", uri: chatUri(scheme, chat.id) },
          { id: LIVE_ACTIONS.stopRun, label: "Stop", data: { chatId: chat.id } },
        ],
      }),
    });
  }

  if (focusing) {
    const paused = Boolean(focusing.focusPausedAt);
    const started = focusing.focusStartedAt ? new Date(focusing.focusStartedAt).getTime() : NaN;
    const taskUri = `${scheme}://tasks/${encodeURIComponent(focusing.id)}`;
    items.push({
      line: `${paused ? "Paused" : "Focusing"} · ${focusing.name}`,
      build: () => ({
        title: focusing.name,
        text: paused ? "Focus paused" : "Focusing",
        ...(!paused && Number.isFinite(started) ? { chronometer: { base: started } } : {}),
        uri: taskUri,
        actions: [
          { id: LIVE_ACTIONS.stopFocus, label: "Stop focus", data: { taskId: focusing.id } },
          { id: "open", label: "Open task", uri: taskUri },
        ],
      }),
    });
  }

  for (const timer of input.pomodoros) {
    const running = timer.endsAt !== null;
    const left = running ? Math.max(0, (timer.endsAt ?? now) - now) : timer.leftMs;
    const phase = PHASE_LABEL[timer.phase];
    const progress = phaseProgress(left, timer.totalMs);
    const what = timer.taskName ? ` · ${timer.taskName}` : "";
    items.push({
      line: `${running ? phase : "Paused"} · ${clock(left)} left${what}`,
      build: () => ({
        title: timer.taskName || `Pomodoro · ${phase}`,
        // The title already names the phase unless it shows the linked task.
        text: running
          ? `${timer.taskName ? `${phase} · ends` : "Ends"} ${timeOfDay(timer.endsAt ?? now)}`
          : `Paused · ${clock(left)} left`,
        ...(running ? { chronometer: { base: timer.endsAt ?? now, countDown: true } } : { chip: clock(left) }),
        ...(progress ? { progress } : {}),
        uri: `${scheme}://dashboard`,
        actions: [
          running
            ? { id: LIVE_ACTIONS.pausePomodoro, label: "Pause", data: { cardId: timer.cardId } }
            : { id: LIVE_ACTIONS.resumePomodoro, label: "Resume", data: { cardId: timer.cardId } },
          { id: LIVE_ACTIONS.skipPomodoro, label: timer.phase === "focus" ? "Take a break" : "Skip break", data: { cardId: timer.cardId } },
        ],
      }),
    });
  }

  if (input.scheduling) {
    items.push({
      line: "Auto-scheduling your tasks…",
      build: () => ({
        title: "Auto-schedule",
        text: "Placing your tasks on the calendar…",
        chip: "Scheduling",
        progress: { max: 0, value: 0, indeterminate: true },
        uri: `${scheme}://calendar`,
        actions: [],
      }),
    });
  }

  if (items.length === 0) return null;
  const lead = items[0].build();
  const more = items.length - 1;
  return {
    ...lead,
    accent: ACCENT,
    ...(more > 0
      ? {
          subText: busy.length > 1 ? `${busy.length} assistant runs` : `${more} more running`,
          bigText: items.map((item) => item.line).join("\n"),
        }
      : {}),
  };
}

/** Steps on the notification's progress bar; fine enough that a 25 minute round moves smoothly. */
export const PROGRESS_STEPS = 1000;

/** How far through the phase the bar sits; none when the length isn't known. */
function phaseProgress(leftMs: number, totalMs?: number) {
  if (!totalMs || totalMs <= 0) return null;
  const done = Math.min(1, Math.max(0, 1 - leftMs / totalMs));
  return { max: PROGRESS_STEPS, value: Math.round(done * PROGRESS_STEPS) };
}

function timeOfDay(at: number) {
  const date = new Date(at);
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** A stable key for "did anything the notification shows change?" (ignores the ticking clock). */
export function liveKey(model: LiveModel | null) {
  if (!model) return "";
  return JSON.stringify({ ...model, text: model.chronometer ? model.text.replace(/\d+:\d+/g, "") : model.text });
}
