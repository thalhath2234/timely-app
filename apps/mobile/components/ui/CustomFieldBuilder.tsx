import { Pressable, StyleSheet, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { Field, PrimaryButton, Select } from "./primitives";
import type { CustomFieldType } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export const FIELD_PALETTE = ["#8b7cf7", "#ef6b5c", "#e8b54a", "#4caf7a", "#5aa7ff", "#f472b6"];

export const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi select" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
  { value: "boolean", label: "Yes / No" },
];

export type OptionDraft = { id?: string; value: string; color: string };

export function needsOptions(type: CustomFieldType) {
  return type === "select" || type === "multi_select";
}

export function cleanedOptions(drafts: OptionDraft[]) {
  return drafts
    .map((option) => ({
      id: option.id,
      value: option.value.trim(),
      color: option.color || FIELD_PALETTE[0],
    }))
    .filter((option) => option.value.length > 0);
}

export function ColorRow({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <View style={styles.colors}>
      {FIELD_PALETTE.map((color) => (
        <Pressable
          key={color}
          onPress={() => onChange(color)}
          style={[
            styles.swatch,
            { backgroundColor: color, borderColor: value === color ? colors.foreground : "transparent" },
          ]}
        />
      ))}
    </View>
  );
}

export function OptionList({
  options,
  onChange,
}: {
  options: OptionDraft[];
  onChange: (next: OptionDraft[]) => void;
}) {
  return (
    <View style={styles.options}>
      <Text style={styles.optionHint}>Option values</Text>
      {options.map((option, index) => (
        <View key={option.id ?? `new-${index}`} style={styles.optionRow}>
          <Pressable
            onPress={() => {
              const nextColor =
                FIELD_PALETTE[(FIELD_PALETTE.indexOf(option.color) + 1) % FIELD_PALETTE.length] ?? FIELD_PALETTE[0];
              const next = [...options];
              next[index] = { ...option, color: nextColor };
              onChange(next);
            }}
            style={[styles.optionDot, { backgroundColor: option.color || FIELD_PALETTE[0] }]}
          />
          <View style={{ flex: 1 }}>
            <Field
              value={option.value}
              onChangeText={(value) => {
                const next = [...options];
                next[index] = { ...option, value };
                onChange(next);
              }}
              placeholder={`Option ${index + 1}`}
              autoCapitalize="sentences"
            />
          </View>
          <Pressable
            onPress={() => onChange(options.filter((_, item) => item !== index))}
            hitSlop={8}
            accessibilityLabel="Remove option"
          >
            <X size={16} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={() => onChange([...options, { value: "", color: FIELD_PALETTE[options.length % FIELD_PALETTE.length] }])}
      >
        <Text style={styles.addOption}>+ Add option</Text>
      </Pressable>
    </View>
  );
}

export default function CustomFieldBuilder({
  name,
  onName,
  type,
  onType,
  options,
  onOptions,
  submitLabel,
  onSubmit,
  disabled,
}: {
  name: string;
  onName: (name: string) => void;
  type: CustomFieldType;
  onType: (type: CustomFieldType) => void;
  options: OptionDraft[];
  onOptions: (next: OptionDraft[]) => void;
  submitLabel: string;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.root}>
      <Field value={name} onChangeText={onName} placeholder="Field name" autoCapitalize="words" />
      <Select
        value={type}
        onChange={(next) => onType(next as CustomFieldType)}
        options={FIELD_TYPES}
        placeholder="Field type"
      />
      {needsOptions(type) ? <OptionList options={options} onChange={onOptions} /> : null}
      <PrimaryButton label={submitLabel} disabled={disabled} onPress={onSubmit} />
    </View>
  );
}

export function LabelComposer({
  name,
  onName,
  color,
  onColor,
  onSubmit,
  disabled,
  submitLabel = "Add label",
}: {
  name: string;
  onName: (name: string) => void;
  color: string;
  onColor: (color: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  submitLabel?: string;
}) {
  return (
    <View style={styles.root}>
      <Field value={name} onChangeText={onName} placeholder="New label" autoCapitalize="words" />
      <ColorRow value={color} onChange={onColor} />
      <PrimaryButton label={submitLabel} disabled={disabled} onPress={onSubmit} />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: { gap: 14 },
  colors: { flexDirection: "row", gap: 12, paddingVertical: 6 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },
  options: { gap: 12 },
  optionHint: { color: colors.foreground, fontSize: 13, fontWeight: "700" },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  optionDot: { width: 28, height: 28, borderRadius: 14 },
  addOption: { color: colors.primary, fontSize: 14, fontWeight: "700", paddingVertical: 8 },
}));
