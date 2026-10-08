"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pause, Play, RotateCcw, Settings2, SkipForward, X } from "lucide-react";
import { formatClock, initialPomodoro, phaseMinutes, pomodoroSettings, type PomodoroPhase } from "@timely/contract/dashboard";
import { todayInZone } from "@timely/contract/workStatus";
import type { Task } from "@/app/_types/types";
import Select from "@/app/_components/_ui/select";
import { useClientGate } from "@/app/_components/_ui/motion";
import { bindPomodoroQueryClient, pomodoroTimeLeft, usePomodoroStore } from "@/app/_store/pomodoroStore";
import { cn } from "@/app/utils/cn";
import { useElementSize } from "./charts";

const PHASE_LABEL: Record<PomodoroPhase, string> = { focus: "Focus", short: "Short break", long: "Long break" };

/**
 * The pomodoro card is a view onto the app-level timer in `pomodoroStore`,
 * so the clock keeps running (and chimes) after leaving the Report page.
 */
export default function PomodoroCard({
  cardId,
  settings: rawSettings,
  onSettings,
  tasks,
  timeZone,
}: {
  cardId: string;
  settings?: Record<string, unknown>;
  onSettings: (next: Record<string, unknown>) => void;
  tasks: Task[];
  timeZone?: string;
}) {
  const settings = useMemo(() => pomodoroSettings(rawSettings), [rawSettings]);
  const mounted = useClientGate();
  const queryClient = useQueryClient();
  const stored = usePomodoroStore((store) => store.timers[cardId]);
  const actions = usePomodoroStore.getState();
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState(false);
  const [ref, size] = useElementSize<HTMLDivElement>();

  useEffect(() => {
    bindPomodoroQueryClient(queryClient);
  }, [queryClient]);

  useEffect(() => {
    usePomodoroStore.getState().sync(cardId, rawSettings, timeZone);
  }, [cardId, rawSettings, timeZone]);

  // Server render and first paint show an idle clock; the stored timer takes over after mount.
  const timer = mounted && stored ? stored : { ...initialPomodoro(), cardId, settings };
  const running = timer.endsAt !== null;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  const remaining = Math.min(pomodoroTimeLeft({ ...timer, settings }, now), phaseMinutes(timer.phase, settings) * 60_000);
  const total = phaseMinutes(timer.phase, settings) * 60_000;
  const todayCount = timer.history[todayInZone(timeZone)] ?? 0;
  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;
  const ringSize = Math.max(72, Math.min(size.width - 8, size.height - 8, 200));
  const stroke = ringSize > 120 ? 6 : 4;
  const radius = (ringSize - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const phaseColor = timer.phase === "focus" ? "var(--primary)" : "var(--success)";

  const openTasks = useMemo(
    () =>
      tasks
        .filter((task) => !task.completedAt && task.kind !== "inbox" && task.kind !== "reminder")
        .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"))
        .slice(0, 200),
    [tasks],
  );

  if (editing) {
    return (
      <PomodoroSettingsForm
        settings={settings}
        onClose={() => setEditing(false)}
        onChange={(next) => onSettings({ ...rawSettings, ...next })}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1" role="tablist" aria-label="Pomodoro phase">
        {(["focus", "short", "long"] as const).map((phase) => (
          <button
            key={phase}
            type="button"
            role="tab"
            aria-selected={timer.phase === phase}
            onClick={() => actions.setPhase(cardId, phase)}
            className={cn(
              "rounded-md px-2 py-1 text-xs transition-colors",
              timer.phase === phase ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            {PHASE_LABEL[phase]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          aria-label="Timer settings"
          title="Timer settings"
        >
          <Settings2 className="size-3.5" />
        </button>
      </div>

      <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center">
        <div className="relative" style={{ width: ringSize, height: ringSize }}>
          <svg width={ringSize} height={ringSize} className="-rotate-90" aria-hidden>
            <circle cx={ringSize / 2} cy={ringSize / 2} r={radius} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke={phaseColor}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
              style={{ transition: running ? "stroke-dashoffset 250ms linear" : undefined }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("font-semibold tabular-nums text-foreground", ringSize > 140 ? "text-4xl" : ringSize > 100 ? "text-2xl" : "text-lg")}>
              {formatClock(remaining)}
            </span>
            <span className="mt-0.5 text-[11px] text-muted-foreground">
              {running ? PHASE_LABEL[timer.phase] : timer.remaining !== null ? "Paused" : "Ready"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => actions.reset(cardId)}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          aria-label="Reset"
          title="Reset"
        >
          <RotateCcw className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setNow(Date.now());
            if (running) actions.pause(cardId);
            else actions.start(cardId);
          }}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {running ? <Pause className="size-4" /> : <Play className="size-4" />}
          {running ? "Pause" : timer.remaining !== null ? "Resume" : "Start"}
        </button>
        <button
          type="button"
          onClick={() => actions.skip(cardId)}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          aria-label="Skip to next phase"
          title="Skip"
        >
          <SkipForward className="size-4" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1" aria-label={`Round ${Math.min(timer.round + 1, settings.rounds)} of ${settings.rounds}`}>
          {Array.from({ length: settings.rounds }, (_, index) => (
            <span key={index} className={cn("size-1.5 rounded-full", index < timer.round ? "bg-primary" : "bg-muted-foreground/30")} />
          ))}
        </span>
        <span className="tabular-nums">
          {todayCount} {todayCount === 1 ? "session" : "sessions"} today
        </span>
      </div>

      {size.height > 150 ? (
        <Select
          size="sm"
          value={timer.taskId ?? ""}
          onChange={(value) => {
            const task = openTasks.find((entry) => entry.id === value);
            actions.linkTask(cardId, task ? { id: task.id, name: task.name } : null);
          }}
          options={[{ value: "", label: "No task linked" }, ...openTasks.map((task) => ({ value: task.id, label: task.name }))]}
          aria-label="Task to track time on"
        />
      ) : null}
    </div>
  );
}

function PomodoroSettingsForm({
  settings,
  onChange,
  onClose,
}: {
  settings: ReturnType<typeof pomodoroSettings>;
  onChange: (next: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const field = (key: "focus" | "shortBreak" | "longBreak" | "rounds", label: string, max: number, unit: string) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          max={max}
          value={settings[key]}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value >= 1) onChange({ [key]: Math.min(max, Math.round(value)) });
          }}
          className="w-16 rounded-md border border-border bg-input/30 px-2 py-1 text-right tabular-nums text-foreground outline-none focus:border-ring"
        />
        <span className="w-8 text-xs text-muted-foreground">{unit}</span>
      </span>
    </label>
  );
  return (
    <div className="flex h-full flex-col gap-2.5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Timer settings</span>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground" aria-label="Done">
          <X className="size-3.5" />
        </button>
      </div>
      {field("focus", "Focus", 180, "min")}
      {field("shortBreak", "Short break", 60, "min")}
      {field("longBreak", "Long break", 90, "min")}
      {field("rounds", "Rounds before a long break", 12, "")}
      <label className="flex items-center justify-between gap-3 text-sm text-foreground">
        Start the next round automatically
        <input type="checkbox" checked={settings.autoStart} onChange={(event) => onChange({ autoStart: event.target.checked })} className="accent-[var(--primary)]" />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm text-foreground">
        Chime when a round ends
        <input type="checkbox" checked={settings.sound} onChange={(event) => onChange({ sound: event.target.checked })} className="accent-[var(--primary)]" />
      </label>
    </div>
  );
}
