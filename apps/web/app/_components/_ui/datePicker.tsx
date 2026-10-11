"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, X } from "lucide-react";
import { cn } from "@/app/utils/cn";
import { PopoverView, useClientGate, useViewOpen } from "@/app/_components/_ui/motion";
import {
  fromDatetimeLocalValue,
  toDateInputValue,
  toDatetimeLocalValue,
} from "@/app/utils/calendar";

type DatePickerMode = "date" | "datetime" | "time";

type DatePickerProps = {
  /** `YYYY-MM-DD` in date mode, `YYYY-MM-DDTHH:mm` in datetime, `HH:mm` in time. */
  value: string;
  onChange: (value: string) => void;
  mode?: DatePickerMode;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
  size?: "sm" | "md";
  "aria-label"?: string;
};

type PanelPos = { top: number; left: number };

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const triggerClass =
  "flex w-full items-center gap-2 rounded-lg border border-border bg-input/30 text-left text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60";

function parseLocalDate(value: string): Date | null {
  if (!value) return null;
  if (value.includes("T")) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    0,
    0,
    0,
    0,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function buildMonthCells(month: Date): (Date | null)[] {
  const first = startOfMonth(month);
  const startPad = first.getDay();
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function parseClock(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes: snapMinute(minutes) };
}

function formatClock(hours: number, minutes: number) {
  return `${hour12(hours)}:${pad2(minutes)} ${hours >= 12 ? "PM" : "AM"}`;
}

function formatDisplay(value: string, mode: DatePickerMode) {
  if (mode === "time") {
    const clock = parseClock(value);
    return clock ? formatClock(clock.hours, clock.minutes) : "";
  }

  const date = parseLocalDate(value);
  if (!date) return "";

  if (mode === "date") {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function combineDateTime(day: Date, hours: number, minutes: number) {
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}T${pad2(hours)}:${pad2(minutes)}`;
}

function combineDate(day: Date) {
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`;
}

function snapMinute(raw: number) {
  return (Math.round(raw / 15) * 15) % 60;
}

function hour12(hours24: number) {
  const value = hours24 % 12;
  return value === 0 ? 12 : value;
}

function toHour24(h12: number, pm: boolean) {
  if (h12 === 12) return pm ? 12 : 0;
  return pm ? h12 + 12 : h12;
}

function TimeStepper({
  hours,
  minutes,
  onChange,
  standalone,
}: {
  hours: number;
  minutes: number;
  onChange: (hours: number, minutes: number) => void;
  standalone?: boolean;
}) {
  const pm = hours >= 12;
  const displayHour = hour12(hours);

  return (
    <div className={standalone ? undefined : "mt-3 border-t border-border pt-3"}>
      <div className="grid grid-cols-3 gap-2">
        <WheelColumn
          label="Hour"
          value={pad2(displayHour)}
          onUp={() => onChange((hours + 1) % 24, minutes)}
          onDown={() => onChange((hours + 23) % 24, minutes)}
        />
        <WheelColumn
          label="Min"
          value={pad2(minutes)}
          onUp={() => onChange(hours, (minutes + 15) % 60)}
          onDown={() => onChange(hours, (minutes + 45) % 60)}
        />
        <WheelColumn
          label="Period"
          value={pm ? "PM" : "AM"}
          onUp={() => onChange(toHour24(displayHour, !pm), minutes)}
          onDown={() => onChange(toHour24(displayHour, !pm), minutes)}
        />
      </div>
    </div>
  );
}

function WheelColumn({
  label,
  value,
  onUp,
  onDown,
}: {
  label: string;
  value: string;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-muted/30 px-1 py-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={onUp}
        className="flex h-7 w-full items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronUp className="size-4" />
      </button>
      <div className="flex h-10 w-full items-center justify-center text-lg font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={onDown}
        className="flex h-7 w-full items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronDown className="size-4" />
      </button>
    </div>
  );
}

export default function DatePicker({
  value,
  onChange,
  mode = "date",
  placeholder,
  className,
  disabled,
  clearable = true,
  size = "md",
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useViewOpen();
  const [pos, setPos] = useState<PanelPos | null>(null);
  const mounted = useClientGate();

  const clock = useMemo(
    () => (mode === "time" ? parseClock(value) : null),
    [mode, value],
  );
  const selected = useMemo(
    () => (mode === "time" ? null : parseLocalDate(value)),
    [mode, value],
  );
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(selected ?? new Date()),
  );
  const [hours, setHours] = useState(
    () => clock?.hours ?? selected?.getHours() ?? 9,
  );
  const [minutes, setMinutes] = useState(() =>
    snapMinute(clock?.minutes ?? selected?.getMinutes() ?? 0),
  );

  const panelWidth = mode === "datetime" ? 300 : mode === "time" ? 240 : 280;

  const measure = useCallback((panelHeight = 360): PanelPos | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;

    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const width = panelWidth;
    const height = Math.min(panelHeight, window.innerHeight - margin * 2);

    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - margin) {
      top = rect.top - 4 - height;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));

    let left = rect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

    return { top, left };
  }, [panelWidth]);

  const openPanel = () => {
    if (disabled) return;
    setVisibleMonth(startOfMonth(selected ?? new Date()));
    if (clock) {
      setHours(clock.hours);
      setMinutes(clock.minutes);
    } else if (selected) {
      setHours(selected.getHours());
      setMinutes(snapMinute(selected.getMinutes()));
    } else {
      setHours(9);
      setMinutes(0);
    }
    setPos(measure());
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    const refine = () => {
      const height = panelRef.current?.offsetHeight ?? 320;
      setPos(measure(height));
    };
    const frame = window.requestAnimationFrame(refine);

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Capture phase + stopPropagation: Escape closes only the picker, not
        // the dialog or overlay it sits in.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    function onReposition(event: Event) {
      if (panelRef.current?.contains(event.target as Node)) return;
      const height = panelRef.current?.offsetHeight ?? 320;
      setPos(measure(height));
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, measure, setOpen]);

  const cells = useMemo(() => buildMonthCells(visibleMonth), [visibleMonth]);
  const today = useMemo(() => new Date(), []);
  const label =
    formatDisplay(value, mode) ||
    placeholder ||
    (mode === "datetime"
      ? "Pick date & time"
      : mode === "time"
        ? "Pick a time"
        : "Pick a date");

  const commitDay = (day: Date) => {
    if (mode === "date") {
      onChange(combineDate(day));
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    onChange(combineDateTime(day, hours, minutes));
  };

  const commitTime = (nextHours: number, nextMinutes: number) => {
    setHours(nextHours);
    setMinutes(nextMinutes);
    if (mode === "time") {
      onChange(`${pad2(nextHours)}:${pad2(nextMinutes)}`);
      return;
    }
    const day = selected ?? new Date();
    onChange(combineDateTime(day, nextHours, nextMinutes));
  };

  const TriggerIcon = mode === "time" ? Clock : CalendarDays;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          triggerClass,
          size === "sm" ? "px-2 py-1 text-xs" : "px-2 py-1.5 text-sm",
          className,
        )}
      >
        <TriggerIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            !value && "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {clearable && value && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear date"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onChange("");
            }}
          >
            <X className="size-3.5" />
          </span>
        )}
      </button>

      {mounted &&
        createPortal(
          open && pos ? (
            <PopoverView>
              <div
                ref={panelRef}
                id={panelId}
                role="dialog"
                aria-label={ariaLabel ?? (mode === "time" ? "Choose time" : "Choose date")}
                className={cn(
                  "fixed z-[100] max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl ring-1 ring-foreground/10",
                  mode === "datetime"
                    ? "w-[300px]"
                    : mode === "time"
                      ? "w-[240px]"
                      : "w-[280px]",
                )}
                style={{
                  top: pos.top,
                  left: pos.left,
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
              >
            {mode !== "time" && (
              <>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() =>
                      setVisibleMonth(
                        new Date(
                          visibleMonth.getFullYear(),
                          visibleMonth.getMonth() - 1,
                          1,
                        ),
                      )
                    }
                    className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <p className="text-sm font-medium">
                    {visibleMonth.toLocaleDateString(undefined, {
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() =>
                      setVisibleMonth(
                        new Date(
                          visibleMonth.getFullYear(),
                          visibleMonth.getMonth() + 1,
                          1,
                        ),
                      )
                    }
                    className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>

                <div className="mb-1 grid grid-cols-7 gap-0.5">
                  {WEEKDAYS.map((day) => (
                    <div
                      key={day}
                      className="py-1 text-center text-[11px] font-medium text-muted-foreground"
                    >
                      {day}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-0.5">
                  {cells.map((day, index) => {
                    if (!day) {
                      return <div key={`empty-${index}`} className="size-9" />;
                    }

                    const isSelected = selected ? sameDay(day, selected) : false;
                    const isToday = sameDay(day, today);

                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        onClick={() => commitDay(day)}
                        className={cn(
                          "flex size-9 items-center justify-center rounded-lg text-sm transition-colors",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : isToday
                              ? "bg-accent text-accent-foreground"
                              : "text-foreground hover:bg-muted",
                        )}
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {(mode === "datetime" || mode === "time") && (
              <TimeStepper
                hours={hours}
                minutes={minutes}
                onChange={commitTime}
                standalone={mode === "time"}
              />
            )}

            {(mode !== "time" || clearable) && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const snapped = snapMinute(now.getMinutes());
                  if (mode === "date") onChange(combineDate(now));
                  else if (mode === "time") {
                    setHours(now.getHours());
                    setMinutes(snapped);
                    onChange(`${pad2(now.getHours())}:${pad2(snapped)}`);
                  } else {
                    onChange(combineDateTime(now, now.getHours(), snapped));
                  }
                  if (mode === "date") setOpen(false);
                }}
                className="rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {mode === "time" ? "Now" : "Today"}
              </button>
              {clearable && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
            )}
            </div>
            </PopoverView>
          ) : null,
          document.body,
        )}
    </>
  );
}

/** Controlled date picker bound to ISO / date-string API fields. */
export function DateField({
  value,
  onChange,
  className,
  clearable,
  size,
}: {
  value?: string | null;
  onChange: (value: string) => void;
  className?: string;
  clearable?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <DatePicker
      mode="date"
      value={toDateInputValue(value)}
      onChange={onChange}
      className={className}
      clearable={clearable}
      size={size}
    />
  );
}

/** Controlled time picker bound to `HH:mm` (24-hour) values. */
export function TimeField({
  value,
  onChange,
  className,
  clearable = false,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  clearable?: boolean;
  "aria-label"?: string;
}) {
  return (
    <DatePicker
      mode="time"
      value={value}
      onChange={onChange}
      className={className}
      clearable={clearable}
      aria-label={ariaLabel}
    />
  );
}

/** Controlled datetime picker; emits ISO strings (or "" to clear). */
export function DateTimeField({
  value,
  onChange,
  className,
  clearable,
}: {
  value?: string | Date | null;
  onChange: (isoOrEmpty: string) => void;
  className?: string;
  clearable?: boolean;
}) {
  return (
    <DatePicker
      mode="datetime"
      value={toDatetimeLocalValue(value)}
      onChange={(local) =>
        onChange(local ? fromDatetimeLocalValue(local) : "")
      }
      className={className}
      clearable={clearable}
    />
  );
}
