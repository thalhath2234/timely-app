import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Chip, Field, SectionLabel } from "./primitives";
import DateTimeSheet from "./DateTimeSheet";
import { findCustomFieldDraft, withCustomFieldDraft } from "../../lib/customFields";
import { formatShortDate } from "../../lib/format";
import type { CustomField, CustomFieldValueInput } from "../../lib/types";
import { colors } from "../../lib/theme";

export default function CustomFieldEditor({
  fields,
  values,
  onChange,
}: {
  fields: CustomField[];
  values: CustomFieldValueInput[];
  onChange: (next: CustomFieldValueInput[]) => void;
}) {
  const [dateFieldId, setDateFieldId] = useState<string | null>(null);

  if (fields.length === 0) return null;

  const dateField = fields.find((field) => field.id === dateFieldId);
  const dateDraft = dateField ? findCustomFieldDraft(values, dateField.id) : undefined;
  const dateValue = dateDraft?.stringValue ? new Date(`${dateDraft.stringValue}T00:00:00`) : null;

  function patch(field: CustomField, next: Pick<CustomFieldValueInput, "stringValue" | "optionsValue">) {
    onChange(withCustomFieldDraft(values, field, next));
  }

  return (
    <View style={styles.root}>
      <SectionLabel>Custom fields</SectionLabel>
      {fields.map((field) => {
        const draft = findCustomFieldDraft(values, field.id);
        const stringValue = draft?.stringValue ?? "";
        const selectedIds = (draft?.optionsValue ?? []).map((option) => option.id);
        const options = field.options?.options ?? [];

        if (field.type === "select" || field.type === "multi_select") {
          return (
            <View key={field.id} style={styles.block}>
              <Text style={styles.label}>{field.name}</Text>
              <View style={styles.wrap}>
                {options.map((option) => {
                  const active = selectedIds.includes(option.id);
                  return (
                    <Chip
                      key={option.id}
                      label={option.value}
                      color={option.color}
                      active={active}
                      onPress={() => {
                        if (field.type === "select") {
                          patch(field, { optionsValue: active ? [] : [{ id: option.id }] });
                          return;
                        }
                        patch(field, {
                          optionsValue: (active
                            ? selectedIds.filter((id) => id !== option.id)
                            : [...selectedIds, option.id]
                          ).map((id) => ({ id })),
                        });
                      }}
                    />
                  );
                })}
              </View>
            </View>
          );
        }

        if (field.type === "boolean") {
          return (
            <View key={field.id} style={styles.row}>
              <Text style={styles.label}>{field.name}</Text>
              <Chip
                label={stringValue === "true" ? "Yes" : "No"}
                active={stringValue === "true"}
                onPress={() => patch(field, { stringValue: stringValue === "true" ? "false" : "true" })}
              />
            </View>
          );
        }

        if (field.type === "date") {
          return (
            <Pressable key={field.id} onPress={() => setDateFieldId(field.id)} style={styles.meta}>
              <Text style={styles.label}>{field.name}</Text>
              <Text style={styles.value}>
                {stringValue ? formatShortDate(`${stringValue}T00:00:00`) : "Empty"}
              </Text>
            </Pressable>
          );
        }

        return (
          <View key={field.id} style={styles.block}>
            <Text style={styles.label}>{field.name}</Text>
            <Field
              value={stringValue}
              onChangeText={(next) => patch(field, { stringValue: next })}
              placeholder={field.type === "url" ? "https://" : "Empty"}
              keyboardType={field.type === "number" ? "decimal-pad" : field.type === "url" ? "url" : "default"}
              autoCapitalize={field.type === "url" ? "none" : "sentences"}
            />
          </View>
        );
      })}
      <DateTimeSheet
        open={dateFieldId !== null}
        value={dateValue}
        mode="date"
        onClose={() => setDateFieldId(null)}
        onChange={(next) => {
          if (!dateField) return;
          if (!next) {
            patch(dateField, { stringValue: "" });
            return;
          }
          const y = next.getFullYear();
          const m = String(next.getMonth() + 1).padStart(2, "0");
          const d = String(next.getDate()).padStart(2, "0");
          patch(dateField, { stringValue: `${y}-${m}-${d}` });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  block: { gap: 6 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  label: { color: colors.mutedForeground, fontSize: 13 },
  value: { color: colors.foreground, fontSize: 14 },
  meta: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.input,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
