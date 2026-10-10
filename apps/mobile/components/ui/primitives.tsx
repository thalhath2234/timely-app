import { useState, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Check, ChevronDown, ChevronRight } from "lucide-react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "./AnimatedPressable";
import BottomSheet, { SheetOption } from "./BottomSheet";

export function PrimaryButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      wrapStyle={{ alignSelf: "stretch" }}
      style={[styles.primary, disabled && { opacity: 0.4 }]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </AnimatedPressable>
  );
}

export function Field({
  value,
  onChangeText,
  placeholder,
  secure,
  autoCapitalize = "none",
  multiline,
  autoGrow,
  keyboardType,
  testID,
  onFocus,
  onBlur,
  bare,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  autoCapitalize?: "none" | "sentences" | "words";
  multiline?: boolean;
  autoGrow?: boolean;
  keyboardType?: "default" | "email-address" | "numeric" | "number-pad" | "decimal-pad" | "url";
  testID?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  bare?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  return (
    <TextInput
      testID={testID}
      accessibilityLabel={placeholder}
      value={value}
      onChangeText={onChangeText}
      onFocus={() => { setFocused(true); onFocus?.(); }}
      onBlur={() => { setFocused(false); onBlur?.(); }}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      secureTextEntry={secure}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      keyboardType={keyboardType}
      multiline={multiline}
      scrollEnabled={autoGrow ? false : undefined}
      onContentSizeChange={autoGrow ? (event) => {
        // The web build reports the box's own height, which includes the 2px
        // added below; small changes are ignored so it doesn't grow forever.
        const next = Math.ceil(event.nativeEvent.contentSize.height);
        setContentHeight((prev) => (Math.abs(next - prev) <= 2 ? prev : next));
      } : undefined}
      selectionColor={colors.primary}
      style={[styles.input, multiline && styles.area, focused && styles.inputFocused, bare && styles.inputBare, bare && multiline && styles.inputBareArea, bare && focused && styles.inputBareFocused, autoGrow && { height: Math.max(38, contentHeight + 2) }]}
    />
  );
}

export function Chip({
  label,
  active,
  onPress,
  color,
  bare,
  fill,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  color?: string | null;
  bare?: boolean;
  fill?: boolean;
}) {
  const tint = color && active && !bare ? `${color}33` : undefined;
  const border = color ? (active ? `${color}88` : colors.border) : undefined;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      hitSlop={bare || fill ? 0 : 6}
      onPress={onPress}
      android_ripple={{ color: bare ? "transparent" : `${colors.primary}33`, borderless: false }}
      style={[
        styles.chip,
        bare ? styles.chipBare : null,
        fill ? styles.chipFill : null,
        active && !bare && !color ? styles.chipOn : null,
        color && !bare ? { borderColor: border, backgroundColor: tint || colors.card } : null,
      ]}
    >
      {active && !bare ? <Check size={14} color={color || colors.primaryForeground} strokeWidth={2.5} /> : null}
      {color ? <View style={[styles.chipDot, { backgroundColor: color }]} /> : null}
      <Text
        numberOfLines={1}
        style={[
          styles.chipText,
          active && (!color || bare) ? { color: colors.primaryForeground, fontWeight: "600" } : null,
          active && color && !bare ? { color } : null,
        ]}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

export type SelectOption = { value: string; label: string; color?: string };

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <View>
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={selected?.label ?? placeholder}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={styles.selectTrigger}
      >
        {selected?.color ? <Dot color={selected.color} /> : null}
        <Text style={[styles.selectValue, !selected && { color: colors.mutedForeground }]} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <ChevronDown size={16} color={colors.mutedForeground} />
      </AnimatedPressable>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={placeholder}>
        {options.map((option) => (
          <SheetOption
            key={option.value || "__empty"}
            selected={option.value === value}
            leading={option.color ? <Dot color={option.color} /> : undefined}
            onSelect={() => {
              onChange(option.value);
              setOpen(false);
            }}
          >
            {option.label}
          </SheetOption>
        ))}
      </BottomSheet>
    </View>
  );
}

/** A section heading. `compact` drops the outer margins, for a heading
 * inside a card's own header row. */
export function SectionLabel({ children, action, compact }: { children: ReactNode; action?: ReactNode; compact?: boolean }) {
  if (!action) return <Text style={[styles.section, compact && styles.sectionCompact]}>{children}</Text>;
  return (
    <View style={[styles.sectionRow, compact && styles.sectionCompact]}>
      <Text style={styles.sectionInRow}>{children}</Text>
      {action}
    </View>
  );
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  if (onPress) {
    return (
      <AnimatedPressable accessibilityRole="button" onPress={onPress} style={styles.card}>
        {children}
      </AnimatedPressable>
    );
  }
  return <View style={styles.card}>{children}</View>;
}

/** Grouped property list used on task detail and the new-item form. */
export function PropertyGroup({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "card" }) {
  return <View style={[styles.propertyGroup, tone === "card" && styles.propertyGroupCard]}>{children}</View>;
}

export function PropertyRow({
  icon,
  label,
  value,
  onPress,
  tone,
  swatch,
  action,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  onPress?: () => void;
  tone?: string;
  swatch?: string | null;
  action?: ReactNode;
}) {
  return (
    <AnimatedPressable
      accessibilityRole={onPress ? "button" : "none"}
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      disabled={!onPress}
      style={styles.propertyRow}
    >
      {icon}
      <Text style={styles.propertyLabel}>{label}</Text>
      {swatch ? <Dot color={swatch} /> : null}
      <Text style={[styles.propertyValue, tone ? { color: tone } : null]} numberOfLines={2} ellipsizeMode="tail">
        {value}
      </Text>
      {action}
      {onPress && !action ? <ChevronRight size={16} color={colors.mutedForeground} /> : null}
    </AnimatedPressable>
  );
}

export function Dot({ color }: { color?: string | null }) {
  return <View style={[styles.dot, { backgroundColor: color || colors.mutedForeground }]} />;
}

const styles = createThemedStyleSheet((colors) => ({
  primary: {
    height: 56,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: colors.primaryForeground, fontSize: 16, fontWeight: "800" },
  input: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    color: colors.foreground,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  inputFocused: { borderWidth: 2, borderColor: colors.primary },
  inputBare: { minHeight: 30, borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0 },
  inputBareArea: { minHeight: 38, paddingTop: 0 },
  inputBareFocused: { borderBottomWidth: 2, borderColor: colors.primary },
  area: { minHeight: 120, textAlignVertical: "top", paddingTop: 12 },
  chip: {
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.ring },
  chipBare: { backgroundColor: "transparent", borderColor: "transparent" },
  chipFill: { alignSelf: "stretch", justifyContent: "center" },
  chipText: { color: colors.mutedForeground, fontSize: 13, fontWeight: "600" },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  selectTrigger: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: colors.muted,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectValue: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" },
  section: {
    marginTop: 18,
    marginBottom: 10,
    marginLeft: 4,
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  sectionRow: {
    marginTop: 18,
    marginBottom: 10,
    marginLeft: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionCompact: { marginTop: 0, marginBottom: 0, marginLeft: 0 },
  sectionInRow: {
    flex: 1,
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  card: {
    borderRadius: 20,
    backgroundColor: colors.card,
    padding: 18,
  },
  propertyGroup: {
    borderRadius: 20,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  propertyGroupCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  propertyRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  propertyLabel: { width: 76, color: colors.mutedForeground, fontSize: 13, fontWeight: "600" },
  propertyValue: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, fontWeight: "700", textAlign: "right" },
  dot: { width: 10, height: 10, borderRadius: 5 },
}));
