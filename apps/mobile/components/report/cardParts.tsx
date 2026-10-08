import { useEffect, useMemo, useRef, useState } from "react";
import { TextInput, type StyleProp, type TextStyle } from "react-native";
import { focusSummary, weekStart, type FocusSummary } from "@timely/contract/dashboard";
import { addDaysToDate, daysBetween } from "@timely/contract/workStatus";
import type { Task } from "../../lib/types";
import { useFocusSessions } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/**
 * Focus sessions from the day before this week's Monday (local midnight, so a
 * session that ran over a zone edge still lands) to tomorrow, summed for the
 * cards. `today` keeps the query key stable for the whole day.
 */
export function useWeekFocus(tasks: Task[], today: string, now: Date, timeZone: string | undefined, enabled = true) {
  const range = useMemo(
    () => ({
      from: new Date(`${addDaysToDate(weekStart(today), -1)}T00:00:00`),
      to: new Date(`${addDaysToDate(today, 1)}T00:00:00`),
    }),
    [today],
  );
  const query = useFocusSessions(range.from, range.to, enabled);
  const sessions = query.data;
  const summary: FocusSummary = useMemo(() => focusSummary(sessions ?? [], tasks, now, timeZone), [sessions, tasks, now, timeZone]);
  return { summary, isLoading: query.isLoading, isError: query.isError };
}

/** "in 25 min", "in 2h 10m". */
export function untilLabel(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours}h` : `in ${hours}h ${rest}m`;
}

/** Tasks carry a day, not a time, in createdAt: "today", "yesterday", "3 days ago". */
export function capturedLabel(createdAt: string | null | undefined, today: string): string {
  if (!createdAt) return "";
  const days = Math.max(0, daysBetween(createdAt.slice(0, 10), today));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * A multiline box that saves a moment after typing stops, like the Scratchpad
 * card: another device's edit shows up unless this one is mid-typing, and a
 * pending save still goes out on blur or when the card goes away.
 */
export function AutosaveText({
  text,
  onChange,
  onDraft,
  placeholder,
  label,
  maxLength = 20_000,
  style,
}: {
  text: string;
  onChange: (text: string) => void;
  /** Every keystroke, before the save goes out. */
  onDraft?: (text: string) => void;
  placeholder: string;
  label: string;
  maxLength?: number;
  style?: StyleProp<TextStyle>;
}) {
  const [value, setValue] = useState(text);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const latest = useRef(onChange);

  useEffect(() => {
    latest.current = onChange;
  });

  useEffect(() => {
    if (!focused.current && pending.current === null) {
      setValue(text);
      onDraft?.(text);
    }
  }, [text]);

  const flush = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next !== null) latest.current(next);
  };

  useEffect(() => () => flush(), []);

  return (
    <TextInput
      value={value}
      multiline
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        flush();
      }}
      onChangeText={(next) => {
        const trimmed = next.slice(0, maxLength);
        setValue(trimmed);
        onDraft?.(trimmed);
        pending.current = trimmed;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(flush, 500);
      }}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      accessibilityLabel={label}
      selectionColor={colors.primary}
      style={[styles.area, style]}
    />
  );
}

const styles = createThemedStyleSheet((colors) => ({
  area: {
    minHeight: 96,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    color: colors.foreground,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
  },
}));

/** A card's settings change: fields to merge, or a function of the latest settings returning them. */
export type SettingsUpdate = (
  next: Record<string, unknown> | ((current: Record<string, unknown>) => Record<string, unknown>),
) => void;
