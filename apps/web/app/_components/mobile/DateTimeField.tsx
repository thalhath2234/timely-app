"use client";

import { useState } from "react";
import { CalendarDays, ChevronRight, Clock, type LucideIcon } from "lucide-react";
import DateTimeSheet, { type DateTimeMode } from "./DateTimeSheet";

interface DateTimeFieldProps {
  label: string;
  value: Date | null;
  onChange: (next: Date | null) => void;
  mode?: DateTimeMode;
  placeholder?: string;
  clearable?: boolean;
  min?: Date | null;
  icon?: LucideIcon;
}

export function formatDateTimeValue(value: Date | null, mode: DateTimeMode) {
  if (!value) return "";
  return value.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(mode === "datetime" ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

/** A tappable row that opens the mobile date & time picker. */
export default function DateTimeField({
  label,
  value,
  onChange,
  mode = "datetime",
  placeholder = "Not set",
  clearable = true,
  min,
  icon,
}: DateTimeFieldProps) {
  const [open, setOpen] = useState(false);
  const Icon = icon ?? (mode === "datetime" ? Clock : CalendarDays);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 w-full items-center gap-3 rounded-xl border border-input bg-card px-4 text-left active:bg-muted"
      >
        <Icon size={18} className="shrink-0 text-muted-foreground" />
        <span className="flex-1 text-[13px] font-medium text-muted-foreground">{label}</span>
        <span className={`text-[15px] ${value ? "text-foreground" : "text-muted-foreground"}`}>
          {value ? formatDateTimeValue(value, mode) : placeholder}
        </span>
        <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
      </button>
      <DateTimeSheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        value={value}
        onChange={onChange}
        mode={mode}
        clearable={clearable}
        min={min}
      />
    </>
  );
}
