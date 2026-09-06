import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import { colors } from "../../lib/theme";

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
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={[styles.primary, disabled && { opacity: 0.4 }]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
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
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  autoCapitalize?: "none" | "sentences" | "words";
  multiline?: boolean;
  keyboardType?: "default" | "email-address" | "numeric" | "number-pad" | "decimal-pad" | "url";
  testID?: string;
}) {
  return (
    <TextInput
      testID={testID}
      accessibilityLabel={placeholder}
      value={value}
      onChangeText={onChangeText}
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
    <Pressable
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
          active && !color ? { color: colors.accentForeground } : null,
          active && color ? { color } : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
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
      <Pressable onPress={() => setOpen((next) => !next)} style={styles.selectTrigger}>
        {selected?.color ? <Dot color={selected.color} /> : null}
        <Text style={[styles.selectValue, !selected && { color: colors.mutedForeground }]} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <ChevronDown size={16} color={colors.mutedForeground} />
      </Pressable>
      {open ? (
        <View style={styles.selectPanel}>
          {options.map((option) => {
            const on = option.value === value;
            return (
              <Pressable
                key={option.value || "__empty"}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={[styles.selectOption, on && styles.selectOptionOn]}
              >
                {option.color ? <Dot color={option.color} /> : null}
                <Text style={[styles.selectOptionText, on && { color: colors.accentForeground }]} numberOfLines={1}>
                  {option.label}
                </Text>
                {on ? <Check size={14} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={styles.card}>
        {children}
      </Pressable>
    );
  }
  return <View style={styles.card}>{children}</View>;
}

export function Dot({ color }: { color?: string | null }) {
  return <View style={[styles.dot, { backgroundColor: color || colors.mutedForeground }]} />;
}

const styles = StyleSheet.create({
  primary: {
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: colors.primaryForeground, fontSize: 15, fontWeight: "600" },
  input: {
    minHeight: 48,
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
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  selectTrigger: {
    minHeight: 48,
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
  selectPanel: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.popover,
    overflow: "hidden",
  },
  selectOption: {
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectOptionOn: { backgroundColor: colors.accent },
  selectOptionText: { flex: 1, color: colors.foreground, fontSize: 15 },
  section: {
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
