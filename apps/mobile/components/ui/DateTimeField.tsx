import { useState } from "react";
import { Text, View } from "react-native";
import { CalendarDays, Clock, X } from "lucide-react-native";
import { colors, controlRadius, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "./AnimatedPressable";
import DateTimeSheet from "./DateTimeSheet";
import { FieldLabel } from "./primitives";

/**
 * A form row that looks like a text field and opens Timely's DateTimeSheet,
 * the phone twin of the desktop DateField/TimeField
 * (docs/design-system.md#date-and-time). Never type a date or time by hand.
 */
export function TimeField({
  label,
  value,
  onChange,
  placeholder = "Pick a time",
  clearable = false,
}: {
  label?: string;
  /** "HH:mm", or "" for none. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const date = parseTime(value);
  return (
    <>
      <FieldTrigger
        label={label}
        icon="time"
        text={date ? formatClock(date) : ""}
        placeholder={placeholder}
        onPress={() => setOpen(true)}
        onClear={clearable && value ? () => onChange("") : undefined}
      />
      <DateTimeSheet
        open={open}
        mode="time"
        title={label}
        value={date}
        clearable={clearable}
        onClose={() => setOpen(false)}
        onChange={(next) => onChange(next ? `${pad(next.getHours())}:${pad(next.getMinutes())}` : "")}
      />
    </>
  );
}

export function DateField({
  label,
  value,
  onChange,
  placeholder = "Pick a date",
  clearable = true,
}: {
  label?: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  placeholder?: string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FieldTrigger
        label={label}
        icon="date"
        text={value ? value.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : ""}
        placeholder={placeholder}
        onPress={() => setOpen(true)}
        onClear={clearable && value ? () => onChange(null) : undefined}
      />
      <DateTimeSheet
        open={open}
        mode="date"
        title={label}
        value={value}
        clearable={clearable}
        onClose={() => setOpen(false)}
        onChange={onChange}
      />
    </>
  );
}

function FieldTrigger({
  label,
  icon,
  text,
  placeholder,
  onPress,
  onClear,
}: {
  label?: string;
  icon: "date" | "time";
  text: string;
  placeholder: string;
  onPress: () => void;
  onClear?: () => void;
}) {
  const Icon = icon === "time" ? Clock : CalendarDays;
  return (
    <View style={label ? styles.wrap : undefined}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}, ${text || placeholder}` : text || placeholder}
        onPress={onPress}
        style={styles.trigger}
      >
        <Icon size={16} color={colors.mutedForeground} />
        <Text style={[styles.value, !text && { color: colors.mutedForeground }]} numberOfLines={1}>
          {text || placeholder}
        </Text>
        {onClear ? (
          <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Clear ${label ?? "value"}`} hitSlop={8} onPress={onClear}>
            <X size={16} color={colors.mutedForeground} />
          </AnimatedPressable>
        ) : null}
      </AnimatedPressable>
    </View>
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function parseTime(value: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date();
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
}

function formatClock(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { gap: 6 },
  trigger: {
    minHeight: 48,
    borderRadius: controlRadius + 2,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  value: { flex: 1, color: colors.foreground, fontSize: 16 },
}));
