"use client";

import { useId, useState } from "react";
import type { LucideIcon } from "lucide-react";
import DatePicker from "@/app/_components/_ui/datePicker";
import Select from "@/app/_components/_ui/select";
import { cn } from "@/app/utils/cn";
import {
  LAST_DAY,
  describeRRule,
  draftToPreset,
  draftToRRule,
  monthLabel,
  presetToDraft,
  weekdayLabel,
  withFreq,
  type RecurrenceDraft,
  type RecurrenceFreq,
  type RecurrencePreset,
} from "@/app/utils/recurrence";

type RecurrenceEditorProps = {
  value: RecurrenceDraft | null;
  onChange: (draft: RecurrenceDraft | null) => void;
  /** First occurrence; decides the default weekday / day-of-month. */
  anchor: Date;
  disabled?: boolean;
  className?: string;
  /**
   * Renders as a property row (icon + label + select) with the custom panel
   * below at full width, instead of squeezing the panel beside the label.
   */
  label?: string;
  icon?: LucideIcon;
};

const FREQ_OPTIONS: { value: RecurrenceFreq; label: string }[] = [
  { value: "DAILY", label: "day(s)" },
  { value: "WEEKLY", label: "week(s)" },
  { value: "MONTHLY", label: "month(s)" },
  { value: "YEARLY", label: "year(s)" },
];

const inputClass =
  "h-7 rounded-lg border border-border bg-input/30 px-2 text-xs text-foreground outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/40 disabled:opacity-50";

const chipClass =
  "flex h-6 items-center justify-center rounded-md border text-[11px] font-medium tabular-nums transition-colors disabled:opacity-50";
const chipOn = "border-primary bg-primary text-primary-foreground";
const chipOff = "border-border text-muted-foreground hover:bg-muted";

/**
 * "Does not repeat" by default; a preset covers the common cadences and
 * "Custom" opens interval, weekday / date / month pickers and end controls.
 */
export default function RecurrenceEditor({
  value,
  onChange,
  anchor,
  disabled,
  className,
  label,
  icon: Icon,
}: RecurrenceEditorProps) {
  // Radio groups are namespaced so two editors on one page do not share state.
  const id = useId();
  const monthlyModeName = `${id}-monthly-mode`;
  const endName = `${id}-end`;
  const matched = draftToPreset(value, anchor);
  const [customOpen, setCustomOpen] = useState(matched === "custom");
  const showCustom = value !== null && (customOpen || matched === "custom");

  const presetOptions: { value: RecurrencePreset; label: string }[] = [
    { value: "none", label: "Does not repeat" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: `Weekly on ${weekdayLabel(anchor.getDay(), true)}` },
    { value: "weekdays", label: "Every weekday" },
    { value: "monthly", label: `Monthly on the ${ordinal(anchor.getDate())}` },
    { value: "yearly", label: `Yearly on ${monthLabel(anchor.getMonth() + 1)} ${anchor.getDate()}` },
    { value: "custom", label: "Custom…" },
  ];

  const update = (patch: Partial<RecurrenceDraft>) => {
    if (!value) return;
    onChange({ ...value, ...patch });
  };

  const select = (
    <Select
      size="sm"
      value={matched}
      disabled={disabled}
      onChange={(preset) => {
        setCustomOpen(preset === "custom");
        if (preset === "custom" && value) return;
        onChange(presetToDraft(preset as RecurrencePreset, anchor));
      }}
      options={presetOptions}
      className={cn(label && "border-0 bg-transparent px-0 shadow-none")}
      aria-label={label ?? "Repeat"}
    />
  );

  const panel = showCustom && value && (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-border bg-muted/20 p-2.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Every</span>
        <input
          type="number"
          min={1}
          max={999}
          value={value.interval}
          disabled={disabled}
          onChange={(event) =>
            update({ interval: Math.max(1, Number(event.target.value) || 1) })
          }
          className={cn(inputClass, "w-14 text-center")}
        />
        <Select
          size="sm"
          value={value.freq}
          disabled={disabled}
          onChange={(freq) => onChange(withFreq(value, freq as RecurrenceFreq, anchor))}
          options={FREQ_OPTIONS}
          className="min-w-0 flex-1"
        />
      </div>

      {value.freq === "WEEKLY" && (
        <Field label="On">
          <div className="grid grid-cols-7 gap-1">
            {[0, 1, 2, 3, 4, 5, 6].map((day) => {
              const active = value.byDay.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  title={weekdayLabel(day, true)}
                  onClick={() => {
                    const next = active
                      ? value.byDay.filter((d) => d !== day)
                      : [...value.byDay, day];
                    // A weekly rule needs at least one day.
                    update({ byDay: next.length ? next : [day] });
                  }}
                  className={cn(chipClass, active ? chipOn : chipOff)}
                >
                  {weekdayLabel(day).slice(0, 2)}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      {value.freq === "MONTHLY" && (
        <div className="flex flex-col gap-2">
          <Radio
            name={monthlyModeName}
            checked={value.monthlyMode === "day"}
            disabled={disabled}
            onChange={() => update({ monthlyMode: "day" })}
          >
            On these dates
          </Radio>
          {value.monthlyMode === "day" && (
            <MonthDayGrid
              value={value.byMonthDay}
              disabled={disabled}
              onChange={(byMonthDay) => update({ byMonthDay })}
            />
          )}
          <Radio
            name={monthlyModeName}
            checked={value.monthlyMode === "weekday"}
            disabled={disabled}
            onChange={() => update({ monthlyMode: "weekday" })}
          >
            On the {ordinalWeek(anchor)} {weekdayLabel(anchor.getDay(), true)}
          </Radio>
        </div>
      )}

      {value.freq === "YEARLY" && (
        <>
          <Field label="In">
            <div className="grid grid-cols-6 gap-1">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                const active = value.byMonth.includes(month);
                return (
                  <button
                    key={month}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={() => {
                      const next = active
                        ? value.byMonth.filter((m) => m !== month)
                        : [...value.byMonth, month];
                      update({ byMonth: next.length ? next : [month] });
                    }}
                    className={cn(chipClass, active ? chipOn : chipOff)}
                  >
                    {monthLabel(month)}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="On these dates">
            <MonthDayGrid
              value={value.byMonthDay}
              disabled={disabled}
              onChange={(byMonthDay) => update({ byMonthDay })}
            />
          </Field>
        </>
      )}

      <Field label="Ends">
        <div className="flex flex-col gap-1.5">
          <Radio
            name={endName}
            checked={value.end.type === "never"}
            disabled={disabled}
            onChange={() => update({ end: { type: "never" } })}
          >
            Never
          </Radio>

          <div className="flex items-center gap-2">
            <Radio
              name={endName}
              checked={value.end.type === "until"}
              disabled={disabled}
              onChange={() =>
                update({
                  end: {
                    type: "until",
                    date: value.end.type === "until" ? value.end.date : "",
                  },
                })
              }
            >
              On
            </Radio>
            <DatePicker
              mode="date"
              value={value.end.type === "until" ? value.end.date : ""}
              disabled={disabled || value.end.type !== "until"}
              clearable={false}
              placeholder="Pick a date"
              onChange={(date) => update({ end: { type: "until", date } })}
              className="h-7 min-w-0 flex-1 py-0.5 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <Radio
              name={endName}
              checked={value.end.type === "count"}
              disabled={disabled}
              onChange={() => update({ end: { type: "count", count: 10 } })}
            >
              After
            </Radio>
            <input
              type="number"
              min={1}
              max={999}
              disabled={disabled || value.end.type !== "count"}
              value={value.end.type === "count" ? value.end.count : 10}
              onChange={(event) =>
                update({
                  end: {
                    type: "count",
                    count: Math.max(1, Number(event.target.value) || 1),
                  },
                })
              }
              className={cn(inputClass, "w-14 text-center")}
            />
            <span className="text-muted-foreground">times</span>
          </div>
        </div>
      </Field>

      <p className="border-t border-border pt-2 text-[11px] leading-snug text-muted-foreground">
        {describeRRule(draftToRRule(value, anchor), anchor)}
      </p>
    </div>
  );

  if (label) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <div className="flex items-center gap-2 rounded-lg px-1 py-1.5">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
          <span title={label} className="w-20 shrink-0 truncate text-xs text-muted-foreground">
            {label}
          </span>
          <div className="flex min-w-0 flex-1 items-center">{select}</div>
        </div>
        {panel && <div className="px-1">{panel}</div>}
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-2", className)}>
      {select}
      {panel}
    </div>
  );
}

/** 1..31 plus "Last"; keeps at least one date selected. */
function MonthDayGrid({
  value,
  disabled,
  onChange,
}: {
  value: number[];
  disabled?: boolean;
  onChange: (days: number[]) => void;
}) {
  const toggle = (day: number) => {
    const active = value.includes(day);
    const next = active ? value.filter((d) => d !== day) : [...value, day];
    onChange(next.length ? next : [day]);
  };

  return (
    <div className="grid grid-cols-7 gap-1">
      {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
        const active = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => toggle(day)}
            className={cn(chipClass, active ? chipOn : chipOff)}
          >
            {day}
          </button>
        );
      })}
      <button
        type="button"
        disabled={disabled}
        aria-pressed={value.includes(LAST_DAY)}
        title="Last day of the month"
        onClick={() => toggle(LAST_DAY)}
        className={cn(chipClass, "col-span-4", value.includes(LAST_DAY) ? chipOn : chipOff)}
      >
        Last day
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Radio({
  name,
  checked,
  disabled,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-foreground">
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="accent-primary"
      />
      {children}
    </label>
  );
}

function ordinal(day: number) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

function ordinalWeek(anchor: Date) {
  const nth = Math.ceil(anchor.getDate() / 7);
  const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const isLast = anchor.getDate() + 7 > lastOfMonth.getDate();
  if (isLast && nth >= 4) return "last";
  return ["", "first", "second", "third", "fourth", "fifth"][nth];
}
