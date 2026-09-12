"use client";

import { FormEvent, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { TimeField } from "@/app/_components/_ui/datePicker";
import type { WeekdayKey, WorkingHours, WorkingWindow } from "@/app/_types/types";
import { browserTimezone } from "@/app/utils/api/schedule";
import {
  useScheduleSettings,
  useUpdateScheduleSettings,
  useUpdateWorkingHours,
  useWorkingHours,
} from "@/app/utils/hooks/calendar";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { cn } from "@/app/utils/cn";

const DAYS: { key: WeekdayKey; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const DEFAULT_WINDOW: WorkingWindow = { start: "09:00", end: "17:00" };

const fieldClass =
  "rounded-lg border border-border bg-input/30 px-2 py-1.5 text-sm text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40";

/** Weekly availability the scheduling engine fills. */
export default function WorkingHoursSettings() {
  const { data: hours, isLoading, isError } = useWorkingHours();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading working hours…</p>;
  }
  if (isError || !hours) {
    return <p className="text-sm text-muted-foreground">Could not load working hours.</p>;
  }

  // Remount on server changes so the draft starts from what is saved.
  return (
    <div className="flex flex-col gap-12">
      <WorkingHoursForm key={JSON.stringify(hours)} initial={hours} />
      <EngineSettingsPanel />
    </div>
  );
}

function WorkingHoursForm({ initial }: { initial: WorkingHours }) {
  const update = useUpdateWorkingHours();
  const [timezone, setTimezone] = useState(initial.timezone || browserTimezone());
  const [days, setDays] = useState<Record<WeekdayKey, WorkingWindow[]>>(() => {
    const next = {} as Record<WeekdayKey, WorkingWindow[]>;
    for (const day of DAYS) next[day.key] = [...(initial.days[day.key] ?? [])];
    return next;
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const timezones = useMemo(() => {
    try {
      const list = (
        Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
      ).supportedValuesOf?.("timeZone");
      if (list && list.length) return list;
    } catch {
      // Older runtimes: fall through to a short list.
    }
    return Array.from(new Set([browserTimezone(), "UTC", timezone]));
  }, [timezone]);

  const weeklyMinutes = useMemo(
    () =>
      DAYS.reduce(
        (sum, day) =>
          sum +
          days[day.key].reduce((daySum, window) => {
            const start = toMinutes(window.start);
            const end = toMinutes(window.end);
            return daySum + (end > start ? end - start : 0);
          }, 0),
        0,
      ),
    [days],
  );

  const validation = useMemo(() => {
    for (const day of DAYS) {
      const windows = [...days[day.key]].sort((a, b) => a.start.localeCompare(b.start));
      let lastEnd = -1;
      for (const window of windows) {
        const start = toMinutes(window.start);
        const end = toMinutes(window.end);
        if (Number.isNaN(start) || Number.isNaN(end)) return `${day.label}: enter both times.`;
        if (end <= start) return `${day.label}: a window must end after it starts.`;
        if (start < lastEnd) return `${day.label}: windows overlap.`;
        lastEnd = end;
      }
    }
    return null;
  }, [days]);

  const setWindow = (key: WeekdayKey, index: number, patch: Partial<WorkingWindow>) => {
    setDays((current) => ({
      ...current,
      [key]: current[key].map((window, i) => (i === index ? { ...window, ...patch } : window)),
    }));
  };

  const addWindow = (key: WeekdayKey) => {
    setDays((current) => {
      const existing = current[key];
      const last = existing[existing.length - 1];
      // A second window starts an hour after the previous one ends.
      const next: WorkingWindow = last
        ? {
            start: fromMinutes(Math.min(toMinutes(last.end) + 60, 22 * 60)),
            end: fromMinutes(Math.min(toMinutes(last.end) + 180, 23 * 60)),
          }
        : DEFAULT_WINDOW;
      return { ...current, [key]: [...existing, next] };
    });
  };

  const removeWindow = (key: WeekdayKey, index: number) => {
    setDays((current) => ({
      ...current,
      [key]: current[key].filter((_, i) => i !== index),
    }));
  };

  const copyMondayToWeekdays = () => {
    setDays((current) => {
      const next = { ...current };
      for (const key of ["tue", "wed", "thu", "fri"] as WeekdayKey[]) {
        next[key] = current.mon.map((window) => ({ ...window }));
      }
      return next;
    });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (validation) {
      setError(validation);
      return;
    }
    try {
      await update.mutateAsync({ timezone, days });
      setMessage("Working hours saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save working hours.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">Working hours</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Auto-schedule only places tasks inside these windows. Events and
          repeating items still show wherever they fall.
          {initial.isDefault ? " You have not saved hours yet; these are the defaults." : ""}
        </p>
      </div>

      <label className="flex max-w-sm flex-col gap-1">
        <span className="text-xs text-muted-foreground">Timezone</span>
        <select
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          className={fieldClass}
        >
          {!timezones.includes(timezone) && <option value={timezone}>{timezone}</option>}
          {timezones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {DAYS.map((day) => {
          const windows = days[day.key];
          return (
            <div key={day.key} className="flex items-start gap-4 px-3 py-2.5">
              <span
                className={cn(
                  "w-24 shrink-0 pt-1.5 text-sm",
                  windows.length ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {day.label}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {windows.length === 0 && (
                  <span className="pt-1.5 text-xs text-muted-foreground">Day off</span>
                )}
                {windows.map((window, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="w-[6.5 rem] shrink-0">
                      <TimeField
                        value={window.start}
                        onChange={(start) => setWindow(day.key, index, { start })}
                        aria-label={`${day.label} start`}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">to</span>
                    <div className="w-[6.5 rem] shrink-0">
                      <TimeField
                        value={window.end}
                        onChange={(end) => setWindow(day.key, index, { end })}
                        aria-label={`${day.label} end`}
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove window from ${day.label}`}
                      onClick={() => removeWindow(day.key, index)}
                      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => addWindow(day.key)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-3.5" />
                {windows.length ? "Split" : "Add hours"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {Math.round((weeklyMinutes / 60) * 10) / 10}h available per week
        </span>
        <button
          type="button"
          onClick={copyMondayToWeekdays}
          className="text-primary underline-offset-2 hover:underline"
        >
          Copy Monday to Tue–Fri
        </button>
      </div>

      {(error || validation) && (
        <p className="text-xs text-destructive">{error ?? validation}</p>
      )}
      {message && !error && <p className="text-xs text-success">{message}</p>}

      <div>
        <button
          type="submit"
          disabled={update.isPending || Boolean(validation)}
          className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {update.isPending ? "Saving..." : "Save working hours"}
        </button>
      </div>
    </form>
  );
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return Number.NaN;
  return hours * 60 + minutes;
}

function fromMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function EngineSettingsPanel() {
  const { data: settings, isLoading, isError } = useScheduleSettings();
  const { data: workspaces } = useWorkspaces();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading engine settings…</p>;
  }
  if (isError || !settings) {
    return <p className="text-sm text-muted-foreground">Could not load engine settings.</p>;
  }

  return (
    <EngineSettingsForm
      initial={settings}
      workspaces={(workspaces ?? []).map((space) => ({ id: space.id, name: space.name }))}
    />
  );
}

function EngineSettingsForm({
  initial,
  workspaces,
}: {
  initial: { breakMinutes: number; freezeHours: number; excludedWorkspaceIds: string[] };
  workspaces: { id: string; name: string }[];
}) {
  const update = useUpdateScheduleSettings();
  const [breakMinutes, setBreakMinutes] = useState(String(initial.breakMinutes ?? 5));
  const [freezeHours, setFreezeHours] = useState(String(initial.freezeHours ?? 0));
  const [excluded, setExcluded] = useState<string[]>(initial.excludedWorkspaceIds ?? []);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleWorkspace = (id: string) => {
    setExcluded((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const breakValue = Number(breakMinutes);
    const freezeValue = Number(freezeHours);
    if (!Number.isFinite(breakValue) || breakValue < 1 || breakValue > 60) {
      setError("Buffer must be between 1 and 60 minutes.");
      return;
    }
    if (!Number.isFinite(freezeValue) || freezeValue < 0 || freezeValue > 168) {
      setError("Freeze window must be between 0 and 168 hours.");
      return;
    }
    try {
      await update.mutateAsync({
        breakMinutes: Math.round(breakValue),
        freezeHours: Math.round(freezeValue),
        excludedWorkspaceIds: excluded,
      });
      setMessage("Engine settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save engine settings.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-5 border-t border-border pt-8">
      <div>
        <h2 className="text-base font-semibold text-foreground">Auto-schedule engine</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Buffer time sits between placed blocks. Freeze keeps the next hours from being
          rewritten. Excluded workspaces are skipped entirely.
        </p>
      </div>

      <div className="grid max-w-lg grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Buffer between blocks (minutes)</span>
          <input
            type="number"
            min={1}
            max={60}
            value={breakMinutes}
            onChange={(event) => setBreakMinutes(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Freeze next hours</span>
          <input
            type="number"
            min={0}
            max={168}
            value={freezeHours}
            onChange={(event) => setFreezeHours(event.target.value)}
            className={fieldClass}
          />
          <span className="text-[11px] text-muted-foreground">
            0 keeps every hour movable. 24 freezes about the next day.
          </span>
        </label>
      </div>

      {workspaces.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Exclude workspaces from auto-schedule</span>
          <div className="flex flex-wrap gap-2">
            {workspaces.map((space) => {
              const on = excluded.includes(space.id);
              return (
                <label
                  key={space.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                    on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleWorkspace(space.id)}
                    className="size-3.5 accent-primary"
                  />
                  {space.name}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {message && !error && <p className="text-xs text-success">{message}</p>}

      <div>
        <button
          type="submit"
          disabled={update.isPending}
          className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {update.isPending ? "Saving..." : "Save engine settings"}
        </button>
      </div>
    </form>
  );
}
