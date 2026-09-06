import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import CustomFieldBuilder, {
  FIELD_PALETTE,
  LabelComposer,
  cleanedOptions,
  needsOptions,
  type OptionDraft,
} from "./CustomFieldBuilder";
import CustomFieldEditor from "./CustomFieldEditor";
import { Chip, SectionLabel } from "./primitives";
import { createCustomField, createLabel } from "../../lib/api/workspaces";
import { emptyCustomFieldDrafts, withCustomFieldDraft } from "../../lib/customFields";
import { keys } from "../../lib/hooks";
import type { CustomField, CustomFieldType, CustomFieldValueInput, Workspace } from "../../lib/types";
import { colors } from "../../lib/theme";

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

export default function TaskMetaEditor({
  workspace,
  workspaceId,
  labelIds,
  onLabelIds,
  values,
  onValues,
}: {
  workspace?: Workspace;
  workspaceId: string;
  labelIds: string[];
  onLabelIds: (ids: string[]) => void;
  values: CustomFieldValueInput[];
  onValues: (next: CustomFieldValueInput[]) => void;
}) {
  const client = useQueryClient();
  const labels = workspace?.lables ?? [];
  const fields = workspace?.customFields ?? [];
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState(FIELD_PALETTE[0]);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("select");
  const [options, setOptions] = useState<OptionDraft[]>([{ value: "", color: FIELD_PALETTE[0] }]);
  const [addingField, setAddingField] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    await client.invalidateQueries({ queryKey: keys.workspaces });
  }

  async function addLabel() {
    const name = labelName.trim();
    if (!workspaceId || !name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createLabel(workspaceId, { name, color: labelColor });
      const id = entityId(created);
      setLabelName("");
      await refresh();
      if (id) onLabelIds([...labelIds, id]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create label.");
    } finally {
      setBusy(false);
    }
  }

  async function addField() {
    const name = fieldName.trim();
    if (!workspaceId || !name || busy) return;
    const cleaned = cleanedOptions(options);
    if (needsOptions(fieldType) && cleaned.length === 0) {
      setError("Add at least one option value.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createCustomField(workspaceId, {
        name,
        type: fieldType,
        options: needsOptions(fieldType) ? cleaned : undefined,
      });
      const field = created as CustomField;
      setFieldName("");
      setFieldType("select");
      setOptions([{ value: "", color: FIELD_PALETTE[0] }]);
      setAddingField(false);
      await refresh();
      if (field?.id) {
        onValues(
          withCustomFieldDraft(
            values.length ? values : emptyCustomFieldDrafts([...(fields ?? []), field]),
            field,
            { stringValue: "", optionsValue: [] },
          ),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create custom field.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <SectionLabel>Labels</SectionLabel>
      {labels.length === 0 ? (
        <Text style={styles.hint}>No labels yet. Add one below.</Text>
      ) : (
        <View style={styles.wrap}>
          {labels.map((label) => {
            const active = labelIds.includes(label.id);
            return (
              <Chip
                key={label.id}
                label={label.name}
                color={label.color}
                active={active}
                onPress={() =>
                  onLabelIds(active ? labelIds.filter((id) => id !== label.id) : [...labelIds, label.id])
                }
              />
            );
          })}
        </View>
      )}
      <LabelComposer
        name={labelName}
        onName={setLabelName}
        color={labelColor}
        onColor={setLabelColor}
        disabled={!workspaceId || !labelName.trim() || busy}
        onSubmit={() => void addLabel()}
      />

      <CustomFieldEditor fields={fields} values={values} onChange={onValues} />
      {addingField ? (
        <CustomFieldBuilder
          name={fieldName}
          onName={setFieldName}
          type={fieldType}
          onType={setFieldType}
          options={options}
          onOptions={setOptions}
          submitLabel={busy ? "Adding…" : "Add field"}
          disabled={!workspaceId || !fieldName.trim() || busy}
          onSubmit={() => void addField()}
        />
      ) : (
        <Chip
          label="+ Custom field"
          active={false}
          onPress={() => {
            setError(null);
            setAddingField(true);
          }}
        />
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { color: colors.mutedForeground, fontSize: 13 },
  error: { color: colors.destructive, fontSize: 12 },
});
