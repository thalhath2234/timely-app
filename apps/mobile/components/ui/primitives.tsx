import { useState, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Check, ChevronDown, ChevronRight } from "lucide-react-native";
import { colors, controlRadius, createThemedStyleSheet, radius } from "../../lib/theme";
import { LogoSpinner } from "./TimelyLogo";
import AnimatedPressable from "./AnimatedPressable";
import BottomSheet, { SheetOption } from "./BottomSheet";

/**
 * Timely's one button on the phone, matching the desktop Button
 * (docs/design-system.md#button): same variants, 12px corners, 600 weight.
 * md is 44px (default), lg 48px for the one main action under a form, sm 36px
 * inside cards and rows.
 */
export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive" | "destructive-ghost";

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon,
  loading,
  disabled,
  stretch,
  iconOnly,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  /** A lucide icon element, sized 16. */
  icon?: ReactNode;
  /** Shows the Timely spinner and blocks presses. */
  loading?: boolean;
  disabled?: boolean;
  /** Full width of the parent. */
  stretch?: boolean;
  /** Square button showing only `icon`; `label` becomes the accessibility label. */
  iconOnly?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const inactive = disabled || loading;
  const tone = buttonTone(variant);
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      onPress={onPress}
      disabled={inactive}
      wrapStyle={stretch ? { alignSelf: "stretch" } : undefined}
      style={[
        styles.button,
        size === "sm" ? styles.buttonSm : size === "lg" ? styles.buttonLg : null,
        iconOnly ? { width: size === "sm" ? 36 : size === "lg" ? 48 : 44, paddingHorizontal: 0 } : null,
        { backgroundColor: tone.background, borderColor: tone.border },
        disabled && !loading ? styles.buttonDisabled : null,
      ]}
    >
      {loading ? <LogoSpinner size={16} color={tone.text} /> : icon}
      {iconOnly ? null : <Text numberOfLines={1} style={[styles.buttonText, size === "sm" && styles.buttonTextSm, { color: tone.text }]}>
        {label}
      </Text>}
    </AnimatedPressable>
  );
}

function buttonTone(variant: ButtonVariant) {
  switch (variant) {
    case "secondary":
      return { background: colors.muted, border: "transparent", text: colors.foreground };
    case "outline":
      return { background: colors.card, border: colors.border, text: colors.foreground };
    case "ghost":
      return { background: "transparent", border: "transparent", text: colors.mutedForeground };
    case "destructive-ghost":
      return { background: "transparent", border: "transparent", text: colors.destructive };
    case "destructive":
      return { background: colors.destructiveContainer, border: "transparent", text: colors.destructiveForeground };
    default:
      return { background: colors.primary, border: "transparent", text: colors.primaryForeground };
  }
}

/** The main action under a form: Button primary, lg, full width. */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  return <Button label={label} onPress={onPress} disabled={disabled} loading={loading} testID={testID} size="lg" stretch />;
}

/** A small caption above a control, like the desktop Field label. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
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
  label,
  hint,
}: {
  /** Caption above the field. Required unless the screen already names it. */
  label?: string;
  hint?: string;
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
  const input = (
    <TextInput
      testID={testID}
      accessibilityLabel={label ?? placeholder}
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
  if (!label && !hint) return input;
  return (
    <View style={styles.fieldWrap}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      {input}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
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
  label,
  searchable = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Caption above the trigger; also the sheet title. */
  label?: string;
  /** Adds a filter box at the top of the sheet, for long lists (timezones). */
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(needle))
    : options;
  // Long lists render the first rows only; typing narrows them down.
  const shown = searchable ? matches.slice(0, 60) : matches;
  if (searchable && !needle && selected && !shown.includes(selected)) shown.unshift(selected);
  return (
    <View style={label ? styles.fieldWrap : undefined}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
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
      <BottomSheet
        open={open}
        onClose={() => {
          setOpen(false);
          setQuery("");
        }}
        title={label ?? placeholder}
      >
        {searchable ? (
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search…"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={`Search ${label ?? "options"}`}
            style={[styles.input, styles.sheetSearch]}
          />
        ) : null}
        {searchable && matches.length === 0 ? <Text style={styles.fieldHint}>No matches</Text> : null}
        {shown.map((option) => (
          <SheetOption
            key={option.value || "__empty"}
            selected={option.value === value}
            leading={option.color ? <Dot color={option.color} /> : undefined}
            onSelect={() => {
              onChange(option.value);
              setOpen(false);
              setQuery("");
            }}
          >
            {option.label}
          </SheetOption>
        ))}
        {matches.length > shown.length ? <Text style={styles.fieldHint}>Type to find more</Text> : null}
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
  button: {
    minHeight: 44,
    borderRadius: controlRadius + 2,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonSm: { minHeight: 36, paddingHorizontal: 12, borderRadius: controlRadius },
  buttonLg: { minHeight: 48 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  buttonTextSm: { fontSize: 13 },
  fieldWrap: { gap: 6 },
  fieldLabel: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500", marginLeft: 2 },
  fieldHint: { color: colors.mutedForeground, fontSize: 12, marginLeft: 2 },
  input: {
    minHeight: 48,
    borderRadius: controlRadius + 2,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    color: colors.foreground,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  inputFocused: { borderColor: colors.primary },
  sheetSearch: { marginBottom: 8 },
  inputBare: { minHeight: 30, borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0 },
  inputBareArea: { minHeight: 38, paddingTop: 0 },
  inputBareFocused: { borderBottomWidth: 2, borderColor: colors.primary },
  area: { minHeight: 112, textAlignVertical: "top", paddingTop: 12 },
  chip: {
    minHeight: 36,
    borderRadius: 18,
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
  chipText: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  selectTrigger: {
    minHeight: 48,
    borderRadius: controlRadius + 2,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectValue: { flex: 1, color: colors.foreground, fontSize: 16 },
  section: {
    marginTop: 18,
    marginBottom: 10,
    marginLeft: 4,
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "600",
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
    fontSize: 15,
    fontWeight: "600",
  },
  card: {
    borderRadius: radius + 4,
    backgroundColor: colors.card,
    padding: 18,
  },
  propertyGroup: {
    borderRadius: radius + 4,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  propertyGroupCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  propertyRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  propertyLabel: { width: 76, color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  propertyValue: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, fontWeight: "500", textAlign: "right" },
  dot: { width: 10, height: 10, borderRadius: 5 },
}));
