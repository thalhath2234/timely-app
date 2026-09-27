import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
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
import ConfirmSheet, { type ConfirmRequest } from "../../../../components/ui/ConfirmSheet";
import { keys, useInvalidateAll, useProjectsQuery, useWorkspacesQuery } from "../../../../lib/hooks";
import {
  createCustomField,
  createLabel,
  createStatus,
  deleteCustomField,
  deleteWorkspace,
  deleteLabel,
  deleteStatus,
  updateCustomField,
  updateLabel,
  updateStatus,
  updateWorkspace,
} from "../../../../lib/api/workspaces";
import { createProject } from "../../../../lib/api/projects";
import type { CustomField, CustomFieldType } from "../../../../lib/types";
import { colors, createThemedStyleSheet } from "../../../../lib/theme";
import { useDraftText } from "../../../../lib/draftText";

export default function WorkspaceEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const spaces = useWorkspacesQuery().data ?? [];
  const workspace = spaces.find((w) => w.id === id);
  const invalidateAll = useInvalidateAll();
  const projects = useProjectsQuery();
  const [name, setName] = useDraftText(workspace?.name, id);
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
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [editStatusName, setEditStatusName] = useState("");
  const [editStatusColor, setEditStatusColor] = useState(FIELD_PALETTE[0]);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editLabelName, setEditLabelName] = useState("");
  const [editLabelColor, setEditLabelColor] = useState(FIELD_PALETTE[0]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        <Field value={name} onChangeText={setName} placeholder="Workspace name" autoCapitalize="words" />
        <PrimaryButton
          label="Rename"
          onPress={async () => {
            await updateWorkspace({ id: workspace.id, name: name || workspace.name });
            await refresh();
          }}
        />

        <SectionLabel>Statuses</SectionLabel>
        {(workspace.status ?? []).map((s) => (
          <View key={s.id} style={styles.card}>
            {editingStatusId === s.id ? (
              <>
                <Field value={editStatusName} onChangeText={setEditStatusName} placeholder="Status name" autoCapitalize="words" />
                <ColorRow value={editStatusColor} onChange={setEditStatusColor} />
                <PrimaryButton
                  label="Save status"
                  disabled={!editStatusName.trim()}
                  onPress={async () => {
                    await updateStatus(workspace.id, s.id, { name: editStatusName.trim(), color: editStatusColor });
                    setEditingStatusId(null);
                    await refresh();
                  }}
                />
              </>
            ) : (
              <View style={styles.row}>
                <View style={[styles.dot, { backgroundColor: s.color }]} />
                <Text style={styles.item}>{s.name}</Text>
                <Pressable
                  onPress={() => {
                    setEditingStatusId(s.id);
                    setEditStatusName(s.name);
                    setEditStatusColor(s.color || FIELD_PALETTE[0]);
                  }}
                >
                  <Text style={styles.edit}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    setConfirm({
                      title: "Delete status?",
                      message: s.name,
                      onConfirm: async () => {
                        await deleteStatus(workspace.id, s.id);
                        await refresh();
                      },
                    })
                  }
                >
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
            )}
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
          <View key={l.id} style={styles.card}>
            {editingLabelId === l.id ? (
              <>
                <Field value={editLabelName} onChangeText={setEditLabelName} placeholder="Label name" autoCapitalize="words" />
                <ColorRow value={editLabelColor} onChange={setEditLabelColor} />
                <PrimaryButton
                  label="Save label"
                  disabled={!editLabelName.trim()}
                  onPress={async () => {
                    await updateLabel(workspace.id, l.id, { name: editLabelName.trim(), color: editLabelColor });
                    setEditingLabelId(null);
                    await refresh();
                  }}
                />
              </>
            ) : (
              <View style={styles.row}>
                <View style={[styles.dot, { backgroundColor: l.color }]} />
                <Text style={styles.item}>{l.name}</Text>
                <Pressable
                  onPress={() => {
                    setEditingLabelId(l.id);
                    setEditLabelName(l.name);
                    setEditLabelColor(l.color || FIELD_PALETTE[0]);
                  }}
                >
                  <Text style={styles.edit}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    setConfirm({
                      title: "Delete label?",
                      message: l.name,
                      onConfirm: async () => {
                        await deleteLabel(workspace.id, l.id);
                        await refresh();
                      },
                    })
                  }
                >
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
            )}
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
                  <Pressable
                    onPress={() =>
                      setConfirm({
                        title: "Delete custom field?",
                        message: field.name,
                        onConfirm: async () => {
                          await deleteCustomField(workspace.id, field.id);
                          await refresh();
                        },
                      })
                    }
                  >
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
        <SectionLabel>Danger zone</SectionLabel>
        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Delete workspace</Text>
          <Text style={styles.dangerCopy}>Deletes its tasks, projects, docs, sheets, events, and settings. This cannot be undone.</Text>
          <Pressable
            accessibilityRole="button"
            disabled={spaces.length <= 1 || deleting}
            onPress={() => setConfirm({
              title: `Delete ${workspace.name}?`,
              message: `All content in ${workspace.name} will be permanently deleted.`,
              confirmLabel: "Delete workspace",
              onConfirm: async () => {
                setDeleting(true);
                try {
                  await deleteWorkspace(workspace.id);
                  await invalidateAll();
                  router.replace("/(app)/settings/workspaces");
                } catch (cause) {
                  Alert.alert("Could not delete workspace", cause instanceof Error ? cause.message : "Try again.");
                } finally {
                  setDeleting(false);
                }
              },
            })}
            style={[styles.dangerButton, (spaces.length <= 1 || deleting) && styles.disabled]}
          >
            <Text style={styles.remove}>{deleting ? "Deleting…" : "Delete workspace"}</Text>
          </Pressable>
          {spaces.length <= 1 ? <Text style={styles.meta}>Your last workspace cannot be deleted.</Text> : null}
        </View>
      </ScrollView>
      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        onConfirm={() => confirm?.onConfirm()}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
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
  dangerCard: { borderRadius: 20, borderWidth: 1, borderColor: colors.destructive, backgroundColor: colors.card, padding: 16, gap: 10 },
  dangerTitle: { color: colors.foreground, fontSize: 16, fontWeight: "700" },
  dangerCopy: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  dangerButton: { alignSelf: "flex-start", minHeight: 48, borderRadius: 16, backgroundColor: colors.muted, paddingHorizontal: 16, justifyContent: "center" },
  disabled: { opacity: 0.45 },
}));
