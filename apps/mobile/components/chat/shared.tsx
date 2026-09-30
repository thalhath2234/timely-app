import { type ReactNode } from "react";
import { ActivityIndicator, Text, View, ScrollView } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors, createThemedStyleSheet, radius } from "../../lib/theme";
import RichDoc from "../docs/RichDoc";
import { fromMarkdown } from "../../lib/markdown";
import AnimatedPressable from "../ui/AnimatedPressable";
import { toneColor, type Tone } from "./chatMeta";

/** Text button; `primary` fills, `tone="destructive"` outlines in red. */
export function Action({
  label,
  onPress,
  disabled,
  primary = false,
  icon: Icon,
  tone,
  compact = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  icon?: LucideIcon;
  tone?: Tone;
  compact?: boolean;
  busy?: boolean;
}) {
  const color = primary
    ? colors.primaryForeground
    : tone
      ? toneColor(tone, colors)
      : colors.foreground;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        styles.action,
        compact && styles.actionCompact,
        primary && styles.primary,
        tone === "destructive" && !primary && styles.actionDanger,
        disabled && { opacity: 0.4 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : Icon ? (
        <Icon size={compact ? 15 : 17} color={color} />
      ) : null}
      <Text
        style={[
          styles.actionText,
          compact && styles.actionTextCompact,
          { color },
        ]}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

/** 40 px square icon button matching MobileHeader's HeaderIconButton. */
export function IconButton({
  label,
  onPress,
  children,
  disabled,
  active,
  plain = false,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
  plain?: boolean;
}) {
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      hitSlop={6}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.iconBtn,
        plain && styles.iconBtnPlain,
        active && {
          backgroundColor: colors.accent,
          borderColor: colors.accent,
        },
        disabled && { opacity: 0.4 },
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function Pill({
  label,
  tone = "muted",
  icon: Icon,
}: {
  label: string;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  const color = toneColor(tone, colors);
  return (
    <View style={[styles.pill, { backgroundColor: `${color}22` }]}>
      {Icon ? <Icon size={12} color={color} /> : null}
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function ChatText({
  text,
  onLink,
}: {
  text: string;
  onLink?: (href: string) => void;
}) {
  return text ? (
    <RichDoc content={fromMarkdown(text).content} onLink={onLink} />
  ) : null;
}
export function DetailValue({
  value,
  field = "",
  onLink,
}: {
  value: unknown;
  field?: string;
  onLink: (href: string) => void;
}) {
  if (value == null || value === "")
    return <Text style={styles.muted}>Empty</Text>;
  if (typeof value === "string")
    return field === "markdown" || field === "description" ? (
      <ChatText text={value} onLink={onLink} />
    ) : (
      <Text selectable style={styles.text}>
        {/^\$\d+\./.test(value)
          ? `From change ${Number(value.slice(1).split(".")[0]) + 1}`
          : value}
      </Text>
    );
  if (typeof value !== "object")
    return <Text style={styles.text}>{String(value)}</Text>;
  if (Array.isArray(value))
    return (
      <View style={styles.stack}>
        {value.map((v, i) => (
          <View key={i} style={styles.indent}>
            <DetailValue value={v} onLink={onLink} />
          </View>
        ))}
      </View>
    );
  const record = value as Record<string, unknown>;
  const columns = Array.isArray(record.columns)
    ? (record.columns as { id?: string; name?: string; type?: string }[])
    : null;
  const rows = Array.isArray(record.rows)
    ? (record.rows as { cells?: Record<string, unknown> }[])
    : null;
  return (
    <View style={styles.stack}>
      {columns && rows ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.grid}>
            <View style={[styles.row, styles.headRow]}>
              {columns.map((col, i) => (
                <View key={i} style={styles.cell}>
                  <Text style={styles.cellHead}>
                    {col.name || `Column ${i + 1}`}
                  </Text>
                  <Text style={styles.muted}>{col.type}</Text>
                </View>
              ))}
            </View>
            {rows.map((row, i) => (
              <View key={i} style={styles.row}>
                {columns.map((col, j) => (
                  <View key={j} style={styles.cell}>
                    <DetailValue
                      value={row.cells?.[col.id || col.name || ""]}
                      onLink={onLink}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
      {Object.entries(record)
        .filter(
          ([key]) =>
            !["id", "userId", "createdAt", "updatedAt"].includes(key) &&
            !(columns && rows && ["columns", "rows"].includes(key)),
        )
        .map(([key, val]) => (
          <View key={key} style={styles.field}>
            <Text style={styles.fieldLabel}>
              {key
                .replace(/([A-Z])/g, " $1")
                .replace(/_/g, " ")
                .replace(/^./, (c) => c.toUpperCase())}
            </Text>
            <DetailValue value={val} field={key} onLink={onLink} />
          </View>
        ))}
    </View>
  );
}
export const styles = createThemedStyleSheet(() => ({
  action: {
    minHeight: 48,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    borderRadius: radius,
    paddingHorizontal: 18,
    backgroundColor: colors.muted,
  },
  actionCompact: { minHeight: 40, paddingHorizontal: 14, borderRadius: 14 },
  actionDanger: { backgroundColor: `${colors.destructive}14` },
  primary: { backgroundColor: colors.primary },
  actionText: { fontSize: 15, fontWeight: "700", color: colors.foreground },
  actionTextCompact: { fontSize: 14 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBtnPlain: { backgroundColor: "transparent", borderColor: "transparent" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: 11, fontWeight: "700" },
  text: { color: colors.foreground, fontSize: 14, lineHeight: 22 },
  muted: { color: colors.mutedForeground, fontSize: 12, lineHeight: 19 },
  stack: { gap: 8 },
  indent: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: 12,
  },
  field: { gap: 2 },
  fieldLabel: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  grid: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: { flexDirection: "row" },
  headRow: { backgroundColor: colors.muted },
  cell: {
    width: 150,
    padding: 10,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  cellHead: { color: colors.foreground, fontSize: 13, fontWeight: "700" },
}));
