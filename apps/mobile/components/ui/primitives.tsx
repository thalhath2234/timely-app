import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
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
  keyboardType,
  testID,
  onFocus,
  onBlur,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  autoCapitalize?: "none" | "sentences" | "words";
  multiline?: boolean;
  keyboardType?: "default" | "email-address" | "numeric" | "number-pad" | "decimal-pad" | "url";
  testID?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <TextInput
      testID={testID}
      accessibilityLabel={placeholder}
      value={value}
      onChangeText={onChangeText}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      secureTextEntry={secure}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      keyboardType={keyboardType}
      multiline={multiline}
      style={[styles.input, multiline && styles.area]}
    />
  );
}

export function Chip({
  label,
  active,
  onPress,
  color,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  color?: string | null;
}) {
  const tint = color && active ? `${color}33` : undefined;
  const border = color ? (active ? `${color}88` : colors.border) : undefined;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      hitSlop={6}
      onPress={onPress}
      style={[
        styles.chip,
        active && !color ? styles.chipOn : null,
        color ? { borderColor: border, backgroundColor: tint || colors.card } : null,
      ]}
    >
      {color ? <View style={[styles.chipDot, { backgroundColor: color }]} /> : null}
      <Text
        style={[
          styles.chipText,
          active && !color ? { color: colors.primaryForeground } : null,
          active && color ? { color } : null,
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
      <Pressable
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
      </Pressable>
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

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.card}>
        {children}
      </Pressable>
    );
  }
  return <View style={styles.card}>{children}</View>;
}

export function Dot({ color }: { color?: string | null }) {
  return <View style={[styles.dot, { backgroundColor: color || colors.mutedForeground }]} />;
}

const styles = createThemedStyleSheet((colors) => ({
  primary: {
    height: 52,
    borderRadius: 13,
    backgroundColor: "#4F46E5",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#6366F1",
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
  },
  primaryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    color: colors.foreground,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  area: { minHeight: 120, textAlignVertical: "top", paddingTop: 12 },
  chip: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipOn: { backgroundColor: "#5B4FE9", borderColor: "#7165FF" },
  chipText: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  selectTrigger: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectValue: { flex: 1, color: colors.foreground, fontSize: 15 },
  section: {
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
}));
