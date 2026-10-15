import { useState } from "react";
import { Text, View } from "react-native";
import {
  choiceSelected,
  DATE_PRESETS,
  isFixedDay,
  newCondition,
  numberUnit,
  opTakesValue,
  ruleChoices,
  ruleFieldChoices,
  ruleOpChoices,
  toggleChoice,
  withOp,
} from "@timely/contract/ruleBuilder";
import { PRIORITY_VALUES, ruleFieldInfo } from "@timely/contract/taskQuery";
import { dateWords, type ViewVocabulary } from "@timely/contract/viewLanguage";
import type { TaskRuleField, TaskRuleOp, TaskViewCondition } from "@timely/contract/config";
import type { CustomField } from "../../lib/types";
import { createThemedStyleSheet } from "../../lib/theme";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { DateField } from "../ui/DateTimeField";
import SegmentedControl from "../ui/SegmentedControl";
import { Button, Chip, Field, FieldLabel, SectionLabel, Select } from "../ui/primitives";

function dayToDate(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

function dateToDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A date rule's value: a date word that moves with the calendar, or a day from Timely's picker. */
function DateValue({ label, value, onChange }: { label: string; value: unknown; onChange: (value: string) => void }) {
  const fixed = isFixedDay(value);
  const known = DATE_PRESETS.some((preset) => preset.value === value);
  const options = [
    ...DATE_PRESETS,
    ...(!fixed && !known && typeof value === "string" && value ? [{ value, label: dateWords(value) }] : []),
  ];
  return (
    <View style={styles.block}>
      <Select
        label={label}
        value={fixed ? "" : typeof value === "string" ? value : ""}
        onChange={onChange}
        placeholder={fixed ? "A day you picked" : "Pick a range"}
        options={options}
      />
      <DateField
        value={fixed ? dayToDate(String(value)) : null}
        onChange={(date) => date && onChange(dateToDay(date))}
        placeholder="Or pick a day"
        clearable={false}
      />
    </View>
  );
}

function NumberValue({ label, value, unit, onChange }: { label: string; value: unknown; unit: string; onChange: (value: number) => void }) {
  const saved = typeof value === "number" || typeof value === "string" ? String(value) : "";
  const [draft, setDraft] = useState({ from: saved, text: saved });
  const text = draft.from === saved ? draft.text : saved;
  return (
    <Field
      label={unit ? `${label} (${unit})` : label}
      value={text}
      keyboardType="decimal-pad"
      onChangeText={(next) => {
        setDraft({ from: saved, text: next });
        const number = Number(next);
        if (next.trim() && Number.isFinite(number)) onChange(number);
      }}
    />
  );
}

/**
 * Adds or edits one filter of a view on the phone [rule builder], the twin
 * of the web toolbar's filter editor: pick a field first, then its condition
 * and value. Dates are date words or a day from Timely's own picker.
 */
export default function RuleEditorSheet({
  open,
  rule,
  vocab,
  customFields,
  onChange,
  onRemove,
  onClose,
}: {
  open: boolean;
  /** Null asks for a field first, for a new filter. */
  rule: TaskViewCondition | null;
  vocab: ViewVocabulary;
  customFields: CustomField[];
  onChange: (rule: TaskViewCondition) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const fields = ruleFieldChoices(customFields);

  if (!rule) {
    let section = "";
    return (
      <BottomSheet open={open} onClose={onClose} title="Filter by">
        {fields.map((item) => {
          const heading = item.section !== section ? item.section : null;
          section = item.section;
          return (
            <View key={item.field}>
              {heading ? <SectionLabel>{heading}</SectionLabel> : null}
              <SheetOption onSelect={() => onChange(newCondition(item.field, customFields))}>{item.label}</SheetOption>
            </View>
          );
        })}
      </BottomSheet>
    );
  }

  const info = ruleFieldInfo(rule.field, customFields);
  const kind = info?.kind ?? "text";
  const fieldName = info?.label ?? "Field";
  const ops = ruleOpChoices(rule.field, customFields);

  let value: React.ReactNode = null;
  if (opTakesValue(rule.op)) {
    if (kind === "flag") {
      value = (
        <SegmentedControl
          value={rule.value === false ? "no" : "yes"}
          onChange={(next) => onChange({ ...rule, value: next === "yes" })}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
        />
      );
    } else if (kind === "date") {
      value = (
        <>
          <DateValue
            label={rule.op === "between" ? "From" : "When"}
            value={rule.value}
            onChange={(next) => onChange({ ...rule, value: next })}
          />
          {rule.op === "between" ? <DateValue label="To" value={rule.to} onChange={(next) => onChange({ ...rule, to: next })} /> : null}
        </>
      );
    } else if (kind === "number") {
      const unit = numberUnit(rule.field);
      value = (
        <View style={styles.block}>
          <NumberValue label={rule.op === "between" ? "From" : "Value"} value={rule.value} unit={unit} onChange={(next) => onChange({ ...rule, value: next })} />
          {rule.op === "between" ? (
            <NumberValue label="To" value={rule.to} unit={unit} onChange={(next) => onChange({ ...rule, to: next })} />
          ) : null}
        </View>
      );
    } else if (kind === "choice" && rule.field === "priority" && (rule.op === "gte" || rule.op === "lte")) {
      value = (
        <SegmentedControl
          value={typeof rule.value === "string" ? rule.value : "High"}
          onChange={(next) => onChange({ ...rule, value: next })}
          options={PRIORITY_VALUES.map((level) => ({ value: level, label: level }))}
        />
      );
    } else if (kind === "choice") {
      const choices = ruleChoices(rule.field, vocab);
      value = (
        <View style={styles.block}>
          <FieldLabel>{fieldName}</FieldLabel>
          <View style={styles.row}>
            {choices.map((choice) => (
              <Chip
                key={choice.value}
                label={choice.label}
                color={choice.color}
                active={choiceSelected(rule, choice)}
                onPress={() => onChange(toggleChoice(rule, choice))}
              />
            ))}
          </View>
          {choices.length === 0 ? <Text style={styles.hint}>No {fieldName.toLowerCase()} yet</Text> : null}
        </View>
      );
    } else {
      value = (
        <Field
          label="Words to look for"
          value={typeof rule.value === "string" ? rule.value : ""}
          onChangeText={(next) => onChange({ ...rule, value: next })}
          placeholder="e.g. dentist"
        />
      );
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Edit filter"
      footer={
        <View style={styles.footer}>
          <Button label="Remove filter" variant="destructive-ghost" onPress={onRemove} />
          <View style={{ flex: 1 }}>
            <Button label="Done" onPress={onClose} />
          </View>
        </View>
      }
    >
      <View style={styles.block}>
        <Select
          label="Field"
          searchable
          value={rule.field}
          onChange={(next) => next !== rule.field && onChange(newCondition(next as TaskRuleField, customFields))}
          options={fields.map((item) => ({ value: item.field, label: item.label }))}
        />
        <Select
          label="Condition"
          value={rule.op}
          onChange={(next) => onChange(withOp(rule, next as TaskRuleOp, customFields))}
          options={ops}
        />
        {value}
      </View>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  block: { gap: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { color: colors.mutedForeground, fontSize: 13 },
  footer: { flexDirection: "row", alignItems: "center", gap: 12 },
}));
