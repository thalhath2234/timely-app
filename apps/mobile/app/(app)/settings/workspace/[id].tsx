import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import Screen from "../../../../components/ui/Screen";
import MobileHeader from "../../../../components/ui/MobileHeader";
import CustomFieldBuilder, {
  ColorRow,
  FIELD_PALETTE,
  FIELD_TYPES,
  LabelComposer,
  cleanedOptions,
  needsOptions,
  type OptionDraft,
} from "../../../../components/ui/CustomFieldBuilder";
import { Field, PrimaryButton, SectionLabel } from "../../../../components/ui/primitives";
import { keys, useProjectsQuery, useWorkspacesQuery } from "../../../../lib/hooks";
import {
  createCustomField,
  createLabel,
  createStatus,
  deleteCustomField,
  deleteLabel,
  deleteStatus,
  updateCustomField,
  updateWorkspace,
} from "../../../../lib/api/workspaces";
import { createProject } from "../../../../lib/api/projects";
import type { CustomField, CustomFieldType } from "../../../../lib/types";
import { colors } from "../../../../lib/theme";

export default function WorkspaceEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const workspace = (useWorkspacesQuery().data ?? []).find((w) => w.id === id);
  const projects = useProjectsQuery();
  const [name, setName] = useState(workspace?.name ?? "");
  const [statusName, setStatusName] = useState("");
  const [labelName, setLabelName] = useState("");
  const [color, setColor] = useState(FIELD_PALETTE[0]);
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("select");
  const [fieldOptions, setFieldOptions] = useState<OptionDraft[]>([{ value: "", color: FIELD_PALETTE[0] }]);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<CustomFieldType>("text");
  const [editOptions, setEditOptions] = useState<OptionDraft[]>([]);
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    await client.invalidateQueries({ queryKey: keys.workspaces });
  }

  if (!workspace) {
    return (
      <Screen>
        <MobileHeader title="Workspace" back large={false} />
        <Text style={{ color: colors.mutedForeground, padding: 16 }}>Workspace not found.</Text>
      </Screen>
    );
  }

  const workspaceId = workspace.id;

  function startEdit(field: CustomField) {
    setEditingFieldId(field.id);
    setEditName(field.name);
    setEditType(field.type);
    setEditOptions(
      field.options?.options?.length
        ? field.options.options.map((option) => ({
            id: option.id,
            value: option.value,
            color: option.color || FIELD_PALETTE[0],
          }))
        : [{ value: "", color: FIELD_PALETTE[0] }],
    );
    setError(null);
  }

  async function addField() {
    const trimmed = fieldName.trim();
    if (!trimmed) return;
    const cleaned = cleanedOptions(fieldOptions);
    if (needsOptions(fieldType) && cleaned.length === 0) {
      setError("Add at least one option value.");
      return;
    }
    setError(null);
    await createCustomField(workspaceId, {
      name: trimmed,
      type: fieldType,
      options: needsOptions(fieldType) ? cleaned : undefined,
    });
    setFieldName("");
    setFieldType("select");
    setFieldOptions([{ value: "", color: FIELD_PALETTE[0] }]);
    await refresh();
  }

  async function saveField(fieldId: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    const cleaned = cleanedOptions(editOptions);
    if (needsOptions(editType) && cleaned.length === 0) {
      setError("Add at least one option value.");
      return;
    }
    setError(null);
    await updateCustomField(workspaceId, fieldId, {
      name: trimmed,
      type: editType,
      options: needsOptions(editType) ? cleaned : undefined,
    });
    setEditingFieldId(null);
    await refresh();
  }

  return (
    <Screen>
      <MobileHeader title={workspace.name} back large={false} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}>
        <Field value={name || workspace.name} onChangeText={setName} placeholder="Workspace name" autoCapitalize="words" />
        <PrimaryButton
          label="Rename"
          onPress={async () => {
            await updateWorkspace({ id: workspace.id, name: name || workspace.name });
            await refresh();
          }}
        />

        <SectionLabel>Statuses</SectionLabel>
        {(workspace.status ?? []).map((s) => (
          <View key={s.id} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <Text style={styles.item}>{s.name}</Text>
            <Pressable onPress={() => Alert.alert("Delete status?", s.name, [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: async () => { await deleteStatus(workspace.id, s.id); await refresh(); } },
            ])}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        ))}
        <Field value={statusName} onChangeText={setStatusName} placeholder="New status" autoCapitalize="words" />
        <ColorRow value={color} onChange={setColor} />
        <PrimaryButton
          label="Add status"
          disabled={!statusName.trim()}
          onPress={async () => {
            await createStatus(workspace.id, { name: statusName.trim(), color });
            setStatusName("");
            await refresh();
          }}
        />

        <SectionLabel>Labels</SectionLabel>
        {(workspace.lables ?? []).map((l) => (
          <View key={l.id} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: l.color }]} />
            <Text style={styles.item}>{l.name}</Text>
            <Pressable onPress={async () => { await deleteLabel(workspace.id, l.id); await refresh(); }}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        ))}
        <LabelComposer
          name={labelName}
          onName={setLabelName}
          color={color}
          onColor={setColor}
          disabled={!labelName.trim()}
          onSubmit={async () => {
            await createLabel(workspace.id, { name: labelName.trim(), color });
            setLabelName("");
            await refresh();
          }}
        />

        <SectionLabel>Custom fields</SectionLabel>
        {(workspace.customFields ?? []).map((field) => {
          const editing = editingFieldId === field.id;
          const typeLabel = FIELD_TYPES.find((item) => item.value === field.type)?.label ?? field.type;
          const optionCount = field.options?.options?.length ?? 0;
          return (
            <View key={field.id} style={styles.card}>
              {editing ? (
                <CustomFieldBuilder
                  name={editName}
                  onName={setEditName}
                  type={editType}
                  onType={setEditType}
                  options={editOptions}
                  onOptions={setEditOptions}
                  submitLabel="Save field"
                  onSubmit={() => void saveField(field.id)}
                />
              ) : (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.item}>{field.name}</Text>
                    <Text style={styles.meta}>
                      {typeLabel}
                      {needsOptions(field.type) ? ` · ${optionCount} option${optionCount === 1 ? "" : "s"}` : ""}
                    </Text>
                  </View>
                  <Pressable onPress={() => startEdit(field)}>
                    <Text style={styles.edit}>Edit</Text>
                  </Pressable>
                  <Pressable onPress={async () => { await deleteCustomField(workspace.id, field.id); await refresh(); }}>
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
        <Text style={styles.meta}>Add field</Text>
        <CustomFieldBuilder
          name={fieldName}
          onName={setFieldName}
          type={fieldType}
          onType={setFieldType}
          options={fieldOptions}
          onOptions={setFieldOptions}
          submitLabel="Add field"
          disabled={!fieldName.trim()}
          onSubmit={() => void addField()}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SectionLabel>Projects</SectionLabel>
        {(projects.data ?? [])
          .filter((project) => project.workspaceId === workspace.id)
          .map((project) => (
            <Pressable
              key={project.id}
              onPress={() => router.push(`/(app)/projects/${project.id}`)}
              style={styles.card}
            >
              <Text style={styles.item}>{project.title}</Text>
              <Text style={styles.meta}>{project.status?.name || "Open project"}</Text>
            </Pressable>
          ))}
        <Field value={projectName} onChangeText={setProjectName} placeholder="New project" autoCapitalize="words" />
        <PrimaryButton
          label="Add project"
          disabled={!projectName.trim()}
          onPress={async () => {
            await createProject({ title: projectName.trim(), workspaceId: workspace.id });
            setProjectName("");
            await client.invalidateQueries({ queryKey: keys.projects });
          }}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  item: { flex: 1, color: colors.foreground },
  meta: { color: colors.mutedForeground, fontSize: 12 },
  edit: { color: colors.mutedForeground, fontSize: 13, fontWeight: "600" },
  remove: { color: colors.destructive, fontSize: 13 },
  error: { color: colors.destructive, fontSize: 12 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    gap: 8,
  },
});
