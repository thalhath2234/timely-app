import { useState } from "react";
import { Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { Braces, Tags, Plus, X } from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import CustomFieldBuilder, {
  FIELD_PALETTE,
  LabelComposer,
  cleanedOptions,
  needsOptions,
  type OptionDraft,
} from "./CustomFieldBuilder";
import CustomFieldEditor from "./CustomFieldEditor";
import { Chip } from "./primitives";
import AnimatedPressable from "./AnimatedPressable";
import { createCustomField, createLabel } from "../../lib/api/workspaces";
import { emptyCustomFieldDrafts, withCustomFieldDraft } from "../../lib/customFields";
import { keys } from "../../lib/hooks";
import type { CustomField, CustomFieldType, CustomFieldValueInput, Workspace } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { expandEntering, expandExiting, listLayout } from "../../lib/motion";
import TaskSectionHeader from "../tasks/TaskSectionHeader";

function SubtlePlus({
  label,
  open,
  onPress,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
}) {
  const Icon = open ? X : Plus;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={open ? `Close ${label}` : label}
      hitSlop={8}
      onPress={onPress}
      style={styles.plus}
    >
      <Icon size={14} color={colors.mutedForeground} strokeWidth={2} />
    </AnimatedPressable>
  );
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

export default function TaskMetaEditor({
  workspace,
  workspaceId,
  labelIds,
  onLabelIds,
  values,
  onValues,
  showLabels = true,
  showCustomFields = true,
}: {
  workspace?: Workspace;
  workspaceId: string;
  labelIds: string[];
  onLabelIds: (ids: string[]) => void;
  values: CustomFieldValueInput[];
  onValues: (next: CustomFieldValueInput[]) => void;
  showLabels?: boolean;
  showCustomFields?: boolean;
}) {
  const client = useQueryClient();
  const reduceMotion = useReducedMotion();
  const labels = workspace?.lables ?? [];
  const fields = workspace?.customFields ?? [];
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState(FIELD_PALETTE[0]);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("select");
  const [options, setOptions] = useState<OptionDraft[]>([{ value: "", color: FIELD_PALETTE[0] }]);
  const [addingLabel, setAddingLabel] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetLabelDraft() {
    setLabelName("");
    setLabelColor(FIELD_PALETTE[0]);
  }

  function resetFieldDraft() {
    setFieldName("");
    setFieldType("select");
    setOptions([{ value: "", color: FIELD_PALETTE[0] }]);
  }

  function toggleAddingLabel() {
    setError(null);
    setAddingLabel((open) => {
      if (open) resetLabelDraft();
      return !open;
    });
  }

  function toggleAddingField() {
    setError(null);
    setAddingField((open) => {
      if (open) resetFieldDraft();
      return !open;
    });
  }

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
      resetLabelDraft();
      setAddingLabel(false);
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
      resetFieldDraft();
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
      {showLabels ? (
        <>
          <View style={styles.heading}>
            <View style={styles.headingCopy}><TaskSectionHeader icon={<Tags size={18} color={colors.primary} />} title="Labels & Taxonomy" subtitle="Visual categories and focus filters" badge={`${labelIds.length} active`} badgeTone="muted" /></View>
            <SubtlePlus label="Add label" open={addingLabel} onPress={toggleAddingLabel} />
          </View>
          {labels.length > 0 ? (
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
          ) : null}
          {addingLabel ? (
            <Animated.View
              entering={expandEntering(reduceMotion)}
              exiting={expandExiting(reduceMotion)}
              layout={listLayout(reduceMotion)}
            >
              <LabelComposer
                name={labelName}
                onName={setLabelName}
                color={labelColor}
                onColor={setLabelColor}
                disabled={!workspaceId || !labelName.trim() || busy}
                onSubmit={() => void addLabel()}
              />
            </Animated.View>
          ) : null}
        </>
      ) : null}

      {showCustomFields ? (
        <>
          <View style={styles.heading}>
            <View style={styles.headingCopy}><TaskSectionHeader icon={<Braces size={18} color={colors.primary} />} title="Custom Fields" subtitle="Configurable task details" /></View>
            <SubtlePlus label="Add custom field" open={addingField} onPress={toggleAddingField} />
          </View>
          <CustomFieldEditor hideTitle fields={fields} values={values} onChange={onValues} />
          {addingField ? (
            <Animated.View
              entering={expandEntering(reduceMotion)}
              exiting={expandExiting(reduceMotion)}
              layout={listLayout(reduceMotion)}
            >
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
            </Animated.View>
          ) : null}
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: { gap: 10 },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  headingCopy: { flex: 1, minWidth: 0 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  plus: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  error: { color: colors.destructive, fontSize: 12 },
}));
