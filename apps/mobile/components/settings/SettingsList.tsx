import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { ChevronRight, Plus } from "lucide-react-native";
import AnimatedPressable from "../ui/AnimatedPressable";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/**
 * Grouped settings rows (phone): one card, hairline dividers, 48px rows that
 * open a sheet or a screen. Used by Workspaces, a workspace's page, its
 * statuses/labels/fields sheets and the project settings sheet.
 */
export function ListGroup({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.group, style]} testID={testID}>
      {rows.map((row, index) => (
        <Fragment key={row.key ?? index}>
          {index > 0 ? <View style={styles.divider} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

export function ListRow({
  title,
  meta,
  leading,
  trailing,
  onPress,
  tone = "default",
  chevron,
  disabled,
  testID,
  accessibilityLabel,
}: {
  title: string;
  /** Second line under the title. */
  meta?: string;
  leading?: ReactNode;
  /** Shown before the chevron (a value, a count, row buttons). */
  trailing?: ReactNode;
  onPress?: () => void;
  /** "add" draws a "+ New …" row in the accent; "danger" a destructive one. */
  tone?: "default" | "add" | "danger";
  /** Defaults to on for tappable default rows. */
  chevron?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const showChevron = chevron ?? (Boolean(onPress) && tone === "default");
  const titleColor = tone === "add" ? colors.primary : tone === "danger" ? colors.destructive : colors.foreground;
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? (meta ? `${title}, ${meta}` : title)}
      accessibilityState={disabled ? { disabled: true } : undefined}
      onPress={onPress}
      disabled={disabled || !onPress}
      android_ripple={onPress ? { color: `${colors.primary}1f` } : undefined}
      style={[styles.row, meta ? styles.rowTall : null, disabled && styles.disabled]}
    >
      {tone === "add" && !leading ? <Plus size={18} color={colors.primary} /> : leading}
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.title, { color: titleColor }, tone !== "default" && styles.titleStrong]}>
          {title}
        </Text>
        {meta ? (
          <Text numberOfLines={2} style={styles.meta}>
            {meta}
          </Text>
        ) : null}
      </View>
      {typeof trailing === "string" ? <Text numberOfLines={1} style={styles.value}>{trailing}</Text> : trailing}
      {showChevron ? <ChevronRight size={16} color={colors.mutedForeground} /> : null}
    </AnimatedPressable>
  );
}

/** A small heading above a group, with an optional count or action on the right. */
export function GroupLabel({ children, aside }: { children: string; aside?: ReactNode }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{children}</Text>
      {typeof aside === "string" || typeof aside === "number" ? <Text style={styles.labelAside}>{aside}</Text> : aside}
    </View>
  );
}

/** A line of muted help under a group. */
export function GroupHint({ children }: { children: ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

/** Timely's drawn on/off switch, readable on a card in both themes. */
export function ListSwitch({ value, onChange, label }: { value: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <AnimatedPressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={8}
      onPress={() => onChange(!value)}
      style={[styles.track, value && styles.trackOn]}
    >
      <View style={[styles.thumb, value && styles.thumbOn]} />
    </AnimatedPressable>
  );
}

/** A row that turns something on or off; tapping the title toggles too. `children` sit before the switch (a time pill). */
export function SwitchRow({
  title,
  meta,
  value,
  onChange,
  children,
}: {
  title: string;
  meta?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <View style={[styles.row, meta ? styles.rowTall : null]}>
      <AnimatedPressable accessibilityRole="none" onPress={() => onChange(!value)} style={styles.text}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>
          {title}
        </Text>
        {meta ? (
          <Text numberOfLines={2} style={styles.meta}>
            {meta}
          </Text>
        ) : null}
      </AnimatedPressable>
      {children}
      <ListSwitch label={title} value={value} onChange={onChange} />
    </View>
  );
}

export function ColorDot({ color, size = 10 }: { color?: string | null; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color || colors.mutedForeground }} />;
}

/** A workspace's first letter on a soft wash of its colour. */
export function Monogram({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  const hex = /^#[0-9a-f]{6}$/i.test(color);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: hex ? `${color}26` : colors.accent,
      }}
    >
      <Text style={{ color: hex ? color : colors.accentForeground, fontSize: size >= 40 ? 17 : 15, fontWeight: "600" }}>
        {name.trim().charAt(0).toUpperCase() || "W"}
      </Text>
    </View>
  );
}

/** A read-only chip that previews an item (a status, a label) inside a summary card. */
export function PreviewChip({ label, color, muted }: { label: string; color?: string | null; muted?: boolean }) {
  return (
    <View style={styles.chip}>
      {color ? <ColorDot color={color} size={8} /> : null}
      <Text numberOfLines={1} style={[styles.chipText, muted && { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  group: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 14 },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
  },
  rowTall: { minHeight: 56, paddingVertical: 8 },
  disabled: { opacity: 0.5 },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "500" },
  titleStrong: { fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2, lineHeight: 16 },
  value: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500", maxWidth: 150 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10, marginBottom: 2, marginHorizontal: 4 },
  label: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  labelAside: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  chip: {
    maxWidth: "100%",
    minHeight: 26,
    borderRadius: 13,
    backgroundColor: colors.muted,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  chipText: { flexShrink: 1, color: colors.foreground, fontSize: 12, fontWeight: "500" },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
  track: { width: 40, height: 24, borderRadius: 12, padding: 3, backgroundColor: colors.border },
  trackOn: { backgroundColor: colors.primary },
  thumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.mutedForeground },
  thumbOn: { alignSelf: "flex-end", backgroundColor: colors.primaryForeground },
}));
