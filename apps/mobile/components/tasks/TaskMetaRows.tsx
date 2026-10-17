import { useState } from "react";
import { Keyboard, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import DateTimeSheet from "../ui/DateTimeSheet";
import RecurrenceEditor, { presetLabel } from "../ui/RecurrenceEditor";
import { ColourField } from "../ui/ColourSheet";
import { FIELD_TYPES, OptionList, cleanedOptions, needsOptions, type OptionDraft } from "../ui/CustomFieldBuilder";
import { Field, PrimaryButton, Select } from "../ui/primitives";
import { ColorDot, GroupLabel, ListGroup, ListRow, SwitchRow } from "../settings/SettingsList";
import { createCustomField, createLabel } from "../../lib/api/workspaces";
import { emptyCustomFieldDrafts, findCustomFieldDraft, withCustomFieldDraft } from "../../lib/customFields";
import { formatShortDate } from "../../lib/format";
import { describeRRule, draftToPreset, draftToRRule, type RecurrenceDraft } from "../../lib/recurrence";
import { keys } from "../../lib/hooks";
import { colorForIndex } from "../../lib/entityColor";
import type { CustomField, CustomFieldType, CustomFieldValueInput, Workspace } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/** "Design, Bug" or "Design, Bug +2"; `none` when nothing is picked. */
export function pickSummary(names: string[], none = "None") {
  if (names.length === 0) return none;
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function entityId(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;
  for (const key of ["label", "lable", "customField", "field"]) {
    const inner = record[key];
    if (inner && typeof inner === "object" && typeof (inner as { id?: unknown }).id === "string") {
      return (inner as { id: string }).id;
    }
  }
  return "";
}

function failure(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** "Daily", "Every 2 weeks on Mon, Wed" or "Never" for a Repeat row. */
export function repeatSummary(value: RecurrenceDraft | null, anchor: Date) {
  if (!value) return "Never";
  const preset = draftToPreset(value, anchor);
  return preset === "custom" ? describeRRule(draftToRRule(value, anchor), anchor) : presetLabel(preset, anchor);
}

/** A Repeat row that opens a page with the presets and the custom rule. */
export function RepeatRow({
  value,
  onChange,
  anchor,
  subtitle,
  disabled,
}: {
  value: RecurrenceDraft | null;
  onChange: (draft: RecurrenceDraft | null) => void;
  anchor: Date;
  subtitle?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <ListRow title="Repeat" trailing={repeatSummary(value, anchor)} onPress={() => setOpen(true)} disabled={disabled} testID="repeat-row" />
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Repeat" subtitle={subtitle}>
        <RecurrenceEditor list value={value} onChange={onChange} anchor={anchor} />
      </BottomSheet>
    </View>
  );
}

/**
 * The Labels row of a task's grouped card (task details, the create sheet):
 * a summary of the picked labels that opens a page of them, with "New label"
 * last (docs/design-system.md#sheets-and-create-forms).
 */
export function LabelsRow({
  workspace,
  workspaceId,
  labelIds,
  onLabelIds,
}: {
  workspace?: Workspace;
  workspaceId: string;
  labelIds: string[];
  onLabelIds: (ids: string[]) => void;
}) {
  const client = useQueryClient();
  const labels = workspace?.lables ?? [];
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(colorForIndex(0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = labels.filter((label) => labelIds.includes(label.id));

  function startAdding() {
    setName("");
    setColor(colorForIndex(labels.length));
    setError(null);
    setAdding(true);
  }

  async function add() {
    const trimmed = name.trim();
    if (!workspaceId || !trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = entityId(await createLabel(workspaceId, { name: trimmed, color }));
      Keyboard.dismiss();
      await client.invalidateQueries({ queryKey: keys.workspaces });
      if (id) onLabelIds([...labelIds, id]);
      setAdding(false);
    } catch (cause) {
      setError(failure(cause, "Could not create label."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <ListRow
        title="Labels"
        trailing={picked.length ? <LabelSummary names={picked.map((label) => label.name)} colors={picked.map((label) => label.color)} /> : "None"}
        onPress={() => setOpen(true)}
        testID="labels-row"
      />
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Labels" subtitle={picked.length ? `${picked.length} picked` : undefined}>
        <View style={styles.page}>
          <View>
            {labels.map((label) => {
              const active = labelIds.includes(label.id);
              return (
                <SheetOption
                  key={label.id}
                  selected={active}
                  leading={<ColorDot color={label.color} />}
                  onSelect={() => onLabelIds(active ? labelIds.filter((id) => id !== label.id) : [...labelIds, label.id])}
                >
                  {label.name}
                </SheetOption>
              );
            })}
          </View>
          <ListGroup>
            <ListRow tone="add" title="New label" onPress={startAdding} disabled={!workspaceId} testID="label-new" />
          </ListGroup>
        </View>
        <BottomSheet
          open={adding}
          onClose={() => setAdding(false)}
          title="New label"
          footer={<PrimaryButton label={busy ? "Adding…" : "Add label"} loading={busy} disabled={!name.trim() || !workspaceId} onPress={() => void add()} />}
        >
          <View style={styles.form}>
            <Field label="Name" value={name} onChangeText={setName} placeholder="Label name" autoCapitalize="words" />
            <ColourField value={color} onChange={setColor} subtitle={name.trim() || undefined} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        </BottomSheet>
      </BottomSheet>
    </View>
  );
}

function LabelSummary({ names, colors: dots }: { names: string[]; colors: (string | undefined)[] }) {
  return (
    <View style={styles.summary}>
      <View style={styles.dots}>
        {dots.slice(0, 3).map((color, index) => (
          <ColorDot key={index} color={color} size={8} />
        ))}
      </View>
      <Text numberOfLines={1} style={styles.summaryText}>
        {pickSummary(names)}
      </Text>
    </View>
  );
}

/**
 * A workspace's custom fields as one grouped card: a picker row for select
 * fields, a switch for yes/no, a date row, and an inline value for text,
 * number and URL. "New field" is the last row.
 */
export function CustomFieldsGroup({
  workspace,
  workspaceId,
  values,
  onValues,
  label = "Custom fields",
}: {
  workspace?: Workspace;
  workspaceId: string;
  values: CustomFieldValueInput[];
  onValues: (next: CustomFieldValueInput[]) => void;
  label?: string;
}) {
  const client = useQueryClient();
  const fields = workspace?.customFields ?? [];
  const [multi, setMulti] = useState<string | null>(null);
  const [dateId, setDateId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("select");
  const [options, setOptions] = useState<OptionDraft[]>([{ value: "", color: colorForIndex(0) }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const multiField = fields.find((field) => field.id === multi);
  const dateField = fields.find((field) => field.id === dateId);
  const dateDraft = dateField ? findCustomFieldDraft(values, dateField.id) : undefined;

  function patch(field: CustomField, next: Pick<CustomFieldValueInput, "stringValue" | "optionsValue">) {
    onValues(withCustomFieldDraft(values, field, next));
  }

  function startAdding() {
    setName("");
    setType("select");
    setOptions([{ value: "", color: colorForIndex(0) }]);
    setError(null);
    setAdding(true);
  }

  async function add() {
    const trimmed = name.trim();
    if (!workspaceId || !trimmed || busy) return;
    const cleaned = cleanedOptions(options);
    if (needsOptions(type) && cleaned.length === 0) {
      setError("Add at least one option value.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = (await createCustomField(workspaceId, {
        name: trimmed,
        type,
        options: needsOptions(type) ? cleaned : undefined,
      })) as CustomField;
      Keyboard.dismiss();
      await client.invalidateQueries({ queryKey: keys.workspaces });
      if (created?.id) {
        onValues(
          withCustomFieldDraft(values.length ? values : emptyCustomFieldDrafts([...fields, created]), created, {
            stringValue: "",
            optionsValue: [],
          }),
        );
      }
      setAdding(false);
    } catch (cause) {
      setError(failure(cause, "Could not create custom field."));
    } finally {
      setBusy(false);
    }
  }

  const rows = fields.map((field) => {
    const draft = findCustomFieldDraft(values, field.id);
    const stringValue = draft?.stringValue ?? "";
    const selectedIds = (draft?.optionsValue ?? []).map((option) => option.id);
    const fieldOptions = field.options?.options ?? [];

    if (field.type === "select") {
      return (
        <Select
          key={field.id}
          trigger="row"
          label={field.name}
          value={selectedIds[0] ?? ""}
          placeholder="None"
          options={[{ value: "", label: "None" }, ...fieldOptions.map((option) => ({ value: option.id, label: option.value, color: option.color }))]}
          onChange={(id) => patch(field, { optionsValue: id ? [{ id }] : [] })}
        />
      );
    }
    if (field.type === "multi_select") {
      const picked = fieldOptions.filter((option) => selectedIds.includes(option.id));
      return (
        <ListRow
          key={field.id}
          title={field.name}
          trailing={picked.length ? <LabelSummary names={picked.map((option) => option.value)} colors={picked.map((option) => option.color)} /> : "None"}
          onPress={() => setMulti(field.id)}
        />
      );
    }
    if (field.type === "boolean") {
      return (
        <SwitchRow
          key={field.id}
          title={field.name}
          value={stringValue === "true"}
          onChange={(next) => patch(field, { stringValue: next ? "true" : "false" })}
        />
      );
    }
    if (field.type === "date") {
      return (
        <ListRow
          key={field.id}
          title={field.name}
          trailing={stringValue ? formatShortDate(`${stringValue}T00:00:00`) : "None"}
          onPress={() => setDateId(field.id)}
        />
      );
    }
    return (
      <ListRow
        key={field.id}
        title={field.name}
        trailing={
          <View style={styles.inline}>
            <Field
              bare
              value={stringValue}
              onChangeText={(next) => patch(field, { stringValue: next })}
              placeholder={field.type === "url" ? "https://" : field.type === "number" ? "0" : "Empty"}
              keyboardType={field.type === "number" ? "decimal-pad" : field.type === "url" ? "url" : "default"}
              autoCapitalize={field.type === "url" ? "none" : "sentences"}
              accessibilityLabel={field.name}
              align="right"
            />
          </View>
        }
      />
    );
  });

  return (
    <View style={styles.section}>
      <GroupLabel aside={fields.length ? String(fields.length) : undefined}>{label}</GroupLabel>
      <ListGroup>
        {rows}
        <ListRow key="__new" tone="add" title="New field" onPress={startAdding} disabled={!workspaceId} testID="field-new" />
      </ListGroup>

      <BottomSheet open={multiField !== undefined} onClose={() => setMulti(null)} title={multiField?.name ?? "Options"}>
        <View style={styles.page}>
          <View>
            {(multiField?.options?.options ?? []).map((option) => {
              const draft = multiField ? findCustomFieldDraft(values, multiField.id) : undefined;
              const selectedIds = (draft?.optionsValue ?? []).map((item) => item.id);
              const active = selectedIds.includes(option.id);
              return (
                <SheetOption
                  key={option.id}
                  selected={active}
                  leading={<ColorDot color={option.color} />}
                  onSelect={() => {
                    if (!multiField) return;
                    patch(multiField, {
                      optionsValue: (active ? selectedIds.filter((id) => id !== option.id) : [...selectedIds, option.id]).map((id) => ({ id })),
                    });
                  }}
                >
                  {option.value}
                </SheetOption>
              );
            })}
          </View>
          {(multiField?.options?.options ?? []).length === 0 ? <Text style={styles.empty}>No options yet. Add them in workspace settings.</Text> : null}
        </View>
      </BottomSheet>

      <DateTimeSheet
        open={dateField !== undefined}
        value={dateDraft?.stringValue ? new Date(`${dateDraft.stringValue}T00:00:00`) : null}
        mode="date"
        title={dateField?.name}
        onClose={() => setDateId(null)}
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

      <BottomSheet
        open={adding}
        onClose={() => setAdding(false)}
        title="New field"
        subtitle={workspace?.name}
        footer={<PrimaryButton label={busy ? "Adding…" : "Add field"} loading={busy} disabled={!name.trim() || !workspaceId} onPress={() => void add()} />}
      >
        <View style={styles.form}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Field name" autoCapitalize="words" />
          <Select label="Type" value={type} onChange={(next) => setType(next as CustomFieldType)} options={FIELD_TYPES} />
          {needsOptions(type) ? <OptionList options={options} onChange={setOptions} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  page: { gap: 10 },
  form: { gap: 14 },
  section: { gap: 6 },
  error: { color: colors.destructive, fontSize: 12 },
  empty: { color: colors.mutedForeground, fontSize: 13, marginHorizontal: 4 },
  summary: { flexShrink: 1, maxWidth: 190, flexDirection: "row", alignItems: "center", gap: 6 },
  dots: { flexDirection: "row", gap: 3 },
  summaryText: { flexShrink: 1, color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  inline: { width: 180 },
}));

