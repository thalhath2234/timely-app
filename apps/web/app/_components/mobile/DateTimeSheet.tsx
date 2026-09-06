"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Trash2 } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { addDays, isSameDay, startOfDay } from "@/app/_lib/mobile/format";

export type DateTimeMode = "date" | "datetime";

interface DateTimeSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Current value; null means unset. */
  value: Date | null;
  onChange: (next: Date | null) => void;
  mode?: DateTimeMode;
  /** Shown as a "Remove" action when the field can be cleared. */
  clearable?: boolean;
  /** Lower bound, e.g. an event's start when picking its end. */
  min?: Date | null;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MINUTE_STEP = 5;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function hour12(h: number) {
  const v = h % 12;
  return v === 0 ? 12 : v;
}

function monthCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

function QuickChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
        active
          ? "border-primary bg-accent text-accent-foreground"
          : "border-border bg-card text-muted-foreground active:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function Wheel({
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
    <div className="flex flex-1 flex-col items-center rounded-2xl border border-border bg-card py-1">
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={onUp}
        className="flex h-9 w-full items-center justify-center rounded-xl text-muted-foreground active:bg-muted"
      >
        <ChevronUp size={20} />
      </button>
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="flex h-9 items-center text-[24px] font-semibold tabular-nums text-foreground">
        {value}
      </span>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={onDown}
        className="flex h-9 w-full items-center justify-center rounded-xl text-muted-foreground active:bg-muted"
      >
        <ChevronDown size={20} />
      </button>
    </div>
  );
}

export default function DateTimeSheet({
  open,
  onClose,
  title,
  value,
  onChange,
  mode = "datetime",
  clearable = false,
  min,
}: DateTimeSheetProps) {
  const initial = useMemo(() => {
    if (value) return value;
    const d = new Date();
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    if (mode === "date") d.setHours(17, 0, 0, 0);
    return d;
  }, [value, mode]);

  const [day, setDay] = useState(() => startOfDay(initial));
  const [hours, setHours] = useState(initial.getHours());
  const [minutes, setMinutes] = useState(initial.getMinutes());
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1),
  );

  // Re-seed each time the sheet is opened so discarded edits do not linger.
  useEffect(() => {
    if (!open) return;
    setDay(startOfDay(initial));
    setHours(initial.getHours());
    setMinutes(initial.getMinutes());
    setVisibleMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
  }, [open, initial]);

  const today = startOfDay(new Date());
  const cells = monthCells(visibleMonth);
  const composed = new Date(day);
  composed.setHours(hours, minutes, 0, 0);
  const belowMin = Boolean(min && composed.getTime() < min.getTime());

  const pm = hours >= 12;

  function commit() {
    if (belowMin) return;
    onChange(composed);
    onClose();
  }

  function clear() {
    onChange(null);
    onClose();
  }

  const footer = (
    <div className="flex flex-col gap-2">
      <p className="text-center text-[13px] text-muted-foreground">
        {composed.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          ...(mode === "datetime" ? { hour: "numeric", minute: "2-digit" } : {}),
        })}
        {belowMin ? " · must be after the start" : ""}
      </p>
      <div className="flex gap-2">
        {clearable && value ? (
          <button
            type="button"
            onClick={clear}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-[15px] font-medium text-destructive active:bg-muted"
          >
            <Trash2 size={16} />
            Remove
          </button>
        ) : null}
        <button
          type="button"
          onClick={commit}
          disabled={belowMin}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
        >
          <Check size={18} />
          Done
        </button>
      </div>
    </div>
  );

  return (
    <BottomSheet open={open} onClose={onClose} title={title} footer={footer}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          <QuickChip label="Today" active={isSameDay(day, today)} onClick={() => setDay(today)} />
          <QuickChip
            label="Tomorrow"
            active={isSameDay(day, addDays(today, 1))}
            onClick={() => setDay(addDays(today, 1))}
          />
          <QuickChip
            label="In 3 days"
            active={isSameDay(day, addDays(today, 3))}
            onClick={() => setDay(addDays(today, 3))}
          />
          <QuickChip
            label="Next week"
            active={isSameDay(day, addDays(today, 7))}
            onClick={() => setDay(addDays(today, 7))}
          />
        </div>

        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="flex items-center justify-between pb-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))
              }
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-[15px] font-semibold text-foreground">
              {visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))
              }
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
            >
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="grid grid-cols-7 pb-1">
            {WEEKDAYS.map((w, i) => (
              <span
                key={`${w}-${i}`}
                className="text-center text-[11px] font-medium text-muted-foreground"
              >
                {w}
              </span>
            ))}
          </div>
          <div role="grid" aria-label="Choose a date" className="grid grid-cols-7 gap-y-0.5">
            {cells.map((cell) => {
              const inMonth = cell.getMonth() === visibleMonth.getMonth();
              const selected = isSameDay(cell, day);
              const isToday = isSameDay(cell, today);
              return (
                <button
                  key={cell.toISOString()}
                  type="button"
                  role="gridcell"
                  aria-selected={selected}
                  aria-label={cell.toDateString()}
                  onClick={() => setDay(cell)}
                  className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-[14px] tabular-nums transition-colors ${
                    selected
                      ? "bg-primary font-semibold text-primary-foreground"
                      : isToday
                        ? "font-semibold text-primary"
                        : inMonth
                          ? "text-foreground active:bg-muted"
                          : "text-muted-foreground/50"
                  }`}
                >
                  {cell.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        {mode === "datetime" ? (
          <div className="flex gap-2">
            <Wheel
              label="Hour"
              value={pad2(hour12(hours))}
              onUp={() => setHours((hours + 1) % 24)}
              onDown={() => setHours((hours + 23) % 24)}
            />
            <Wheel
              label="Min"
              value={pad2(minutes)}
              onUp={() => setMinutes((minutes + MINUTE_STEP) % 60)}
              onDown={() => setMinutes((minutes + 60 - MINUTE_STEP) % 60)}
            />
            <Wheel
              label="Period"
              value={pm ? "PM" : "AM"}
              onUp={() => setHours((hours + 12) % 24)}
              onDown={() => setHours((hours + 12) % 24)}
            />
          </div>
        ) : null}
      </div>
    </BottomSheet>
  );
}
