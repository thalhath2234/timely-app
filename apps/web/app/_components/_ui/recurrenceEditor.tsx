"use client";

import { Fragment, useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import DatePicker from "@/app/_components/_ui/datePicker";
import Select from "@/app/_components/_ui/select";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
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
import { ListRow } from "@/app/_components/_ui/groupedList";

type RecurrenceEditorProps = {
  value: RecurrenceDraft | null;
  onChange: (draft: RecurrenceDraft | null) => void;
  /** First occurrence; decides the default weekday / day-of-month. */
  anchor: Date;
  disabled?: boolean;
  className?: string;
  /** The row's label; "Repeat" by default. */
  label?: string;
};

const FREQS: { value: RecurrenceFreq; label: string }[] = [
  { value: "DAILY", label: "Days" },
  { value: "WEEKLY", label: "Weeks" },
  { value: "MONTHLY", label: "Months" },
  { value: "YEARLY", label: "Years" },
];
type EndType = "never" | "until" | "count";

const cellClass =
  "flex h-7 cursor-pointer items-center justify-center rounded-md text-xs font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const cellOn = "bg-primary text-primary-foreground";
const cellOff = "bg-muted text-foreground hover:bg-muted-foreground/15";

/**
 * The Repeat row of a grouped form (docs/design-system.md#sheets-and-create-forms):
 * a preset on the right, and for Custom more rows under it (Every, Unit, On,
 * Ends) in the same card, like the phone's Repeat page.
 */
export default function RecurrenceEditor({
  value,
  onChange,
  anchor,
  disabled,
  className,
  label = "Repeat",
}: RecurrenceEditorProps) {
  const matched = draftToPreset(value, anchor);
  const [customOpen, setCustomOpen] = useState(matched === "custom");
  const showCustom = value !== null && (customOpen || matched === "custom");

  const presetOptions: { value: RecurrencePreset; label: string }[] = [
    { value: "none", label: "Never" },
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

  const rows: ReactNode[] = [];
  if (showCustom && value) {
    const unit = FREQS.find((f) => f.value === value.freq)!.label.toLowerCase();
    rows.push(
      <ListRow key="every" label="Every">
        <Stepper
          label="Repeat every"
          value={value.interval}
          unit={value.interval === 1 ? unit.slice(0, -1) : unit}
          disabled={disabled}
          onChange={(interval) => update({ interval })}
        />
      </ListRow>,
      <ListRow key="unit" label="Unit">
        <SegmentedControl
          size="sm"
          aria-label="Repeat unit"
          className="*:px-2"
          options={FREQS}
          value={value.freq}
          onChange={(freq) => !disabled && onChange(withFreq(value, freq, anchor))}
        />
      </ListRow>,
    );
    if (value.freq === "WEEKLY") {
      rows.push(
        <ListRow key="on" label="On">
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4, 5, 6].map((day) => {
              const active = value.byDay.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  aria-label={weekdayLabel(day)}
                  title={weekdayLabel(day)}
                  onClick={() => {
                    const next = active ? value.byDay.filter((d) => d !== day) : [...value.byDay, day];
                    // A weekly rule needs at least one day.
                    update({ byDay: next.length ? next : [day] });
                  }}
                  className={cn(cellClass, "size-6 rounded-full text-[11px]", active ? cellOn : cellOff)}
                >
                  {weekdayLabel(day).slice(0, 1)}
                </button>
              );
            })}
          </div>
        </ListRow>,
      );
    }
    if (value.freq === "MONTHLY") {
      rows.push(
        <ListRow key="by" label="By">
          <SegmentedControl
            size="sm"
            aria-label="Monthly by"
            className="*:px-2"
            options={[
              { label: "Dates", value: "day" as const },
              { label: `${capitalise(ordinalWeek(anchor))} ${weekdayLabel(anchor.getDay(), true)}`, value: "weekday" as const },
            ]}
            value={value.monthlyMode}
            onChange={(monthlyMode) => !disabled && update({ monthlyMode })}
          />
        </ListRow>,
      );
      if (value.monthlyMode === "day") {
        rows.push(
          <div key="dates" className="px-3.5 py-2.5">
            <MonthDayGrid value={value.byMonthDay} disabled={disabled} onChange={(byMonthDay) => update({ byMonthDay })} />
          </div>,
        );
      }
    }
    if (value.freq === "YEARLY") {
      rows.push(
        <div key="months" className="flex flex-col gap-2 px-3.5 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">In</span>
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
                    const next = active ? value.byMonth.filter((m) => m !== month) : [...value.byMonth, month];
                    update({ byMonth: next.length ? next : [month] });
                  }}
                  className={cn(cellClass, active ? cellOn : cellOff)}
                >
                  {monthLabel(month)}
                </button>
              );
            })}
          </div>
        </div>,
        <div key="year-dates" className="flex flex-col gap-2 px-3.5 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">On</span>
          <MonthDayGrid value={value.byMonthDay} disabled={disabled} onChange={(byMonthDay) => update({ byMonthDay })} />
        </div>,
      );
    }
    rows.push(
      <ListRow key="ends" label="Ends">
        <SegmentedControl<EndType>
          size="sm"
          aria-label="Ends"
          className="*:px-2"
          options={[
            { label: "Never", value: "never" },
            { label: "On date", value: "until" },
            { label: "After", value: "count" },
          ]}
          value={value.end.type}
          onChange={(type) => {
            if (disabled) return;
            if (type === "never") update({ end: { type: "never" } });
            if (type === "until") update({ end: { type: "until", date: value.end.type === "until" ? value.end.date : "" } });
            if (type === "count") update({ end: { type: "count", count: value.end.type === "count" ? value.end.count : 10 } });
          }}
        />
      </ListRow>,
    );
    if (value.end.type === "until") {
      rows.push(
        <ListRow key="until" label="End date">
          <DatePicker
            variant="row"
            mode="date"
            aria-label="End date"
            value={value.end.date}
            disabled={disabled}
            clearable={false}
            placeholder="Pick a date"
            onChange={(date) => update({ end: { type: "until", date } })}
          />
        </ListRow>,
      );
    }
    if (value.end.type === "count") {
      const count = value.end.count;
      rows.push(
        <ListRow key="count" label="Times">
          <Stepper
            label="Number of times"
            value={count}
            unit={count === 1 ? "time" : "times"}
            disabled={disabled}
            onChange={(next) => update({ end: { type: "count", count: next } })}
          />
        </ListRow>,
      );
    }
    rows.push(
      <p key="summary" className="px-3.5 py-2 text-xs leading-relaxed text-muted-foreground">
        {describeRRule(draftToRRule(value, anchor), anchor)}
      </p>,
    );
  }

  return (
    <div className={className}>
      <ListRow label={label}>
        <Select
          size="sm"
          variant="row"
          value={showCustom ? "custom" : matched}
          disabled={disabled}
          onChange={(preset) => {
            setCustomOpen(preset === "custom");
            if (preset === "custom" && value) return;
            onChange(presetToDraft(preset as RecurrencePreset, anchor));
          }}
          options={presetOptions}
          aria-label={label}
        />
      </ListRow>
      {/* The custom rows join the card the Repeat row sits in, with the same dividers. */}
      {rows.map((row, index) => (
        <Fragment key={index}>
          <div aria-hidden className="ml-3.5 h-px bg-border" />
          {row}
        </Fragment>
      ))}
    </div>
  );
}

/** − 2 weeks +: a small stepper for the right side of a row. */
function Stepper({
  label,
  value,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const step = "flex size-6 cursor-pointer items-center justify-center rounded-md bg-muted text-foreground transition-colors hover:bg-muted-foreground/15 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5";
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <button type="button" aria-label="Fewer" disabled={disabled || value <= 1} onClick={() => onChange(Math.max(1, value - 1))} className={step}>
        <Minus />
      </button>
      <span className="min-w-16 text-center text-[13px] font-semibold tabular-nums text-foreground">
        {value} <span className="font-medium text-muted-foreground">{unit}</span>
      </span>
      <button type="button" aria-label="More" disabled={disabled || value >= 999} onClick={() => onChange(Math.min(999, value + 1))} className={step}>
        <Plus />
      </button>
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
            className={cn(cellClass, active ? cellOn : cellOff)}
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
        className={cn(cellClass, "col-span-4", value.includes(LAST_DAY) ? cellOn : cellOff)}
      >
        Last day
      </button>
    </div>
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

function capitalise(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
