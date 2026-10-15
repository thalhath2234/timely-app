import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { Field, PrimaryButton, Select } from "./primitives";
import { FocusGroup } from "./FocusGroup";
import ColourSheet, { ColourField } from "./ColourSheet";
import { colorForIndex, colorName } from "../../lib/entityColor";
import type { CustomFieldType } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";

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
      color: option.color || colorForIndex(0),
    }))
    .filter((option) => option.value.length > 0);
}

export function OptionList({
  options,
  onChange,
}: {
  options: OptionDraft[];
  onChange: (next: OptionDraft[]) => void;
}) {
  const [picking, setPicking] = useState<number | null>(null);
  const picked = picking !== null ? options[picking] : undefined;
  return (
    <View style={styles.options}>
      <Text style={styles.optionHint}>Option values</Text>
      {options.map((option, index) => (
        <View key={option.id ?? `new-${index}`} style={styles.optionRow}>
          <Pressable
            onPress={() => setPicking(index)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Colour, ${colorName(option.color)}`}
            testID="option-colour"
            style={[styles.optionDot, { backgroundColor: option.color || colorForIndex(index) }]}
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
        onPress={() => onChange([...options, { value: "", color: colorForIndex(options.length) }])}
      >
        <Text style={styles.addOption}>+ Add option</Text>
      </Pressable>
      <ColourSheet
        open={picked !== undefined}
        onClose={() => setPicking(null)}
        value={picked?.color ?? ""}
        subtitle={picked?.value.trim() || (picking !== null ? `Option ${picking + 1}` : undefined)}
        onChange={(color) => {
          if (picking === null || !options[picking]) return;
          const next = [...options];
          next[picking] = { ...options[picking], color };
          onChange(next);
        }}
      />
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
    <FocusGroup style={styles.root}>
      <Field value={name} onChangeText={onName} placeholder="Field name" autoCapitalize="words" />
      <Select
        value={type}
        onChange={(next) => onType(next as CustomFieldType)}
        options={FIELD_TYPES}
        placeholder="Field type"
      />
      {needsOptions(type) ? <OptionList options={options} onChange={onOptions} /> : null}
      <PrimaryButton label={submitLabel} disabled={disabled} onPress={onSubmit} />
    </FocusGroup>
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
    <FocusGroup style={styles.root}>
      <Field value={name} onChangeText={onName} placeholder="New label" autoCapitalize="words" />
      <ColourField value={color} onChange={onColor} subtitle={name.trim() || undefined} />
      <PrimaryButton label={submitLabel} disabled={disabled} onPress={onSubmit} />
    </FocusGroup>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: { gap: 14 },
  options: { gap: 12 },
  optionHint: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  optionDot: { width: 28, height: 28, borderRadius: 14 },
  addOption: { color: colors.primary, fontSize: 14, fontWeight: "600", paddingVertical: 8 },
}));
