import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import Screen from "../../../../components/ui/Screen";
import MobileHeader from "../../../../components/ui/MobileHeader";
import { Field, PrimaryButton, SectionLabel } from "../../../../components/ui/primitives";
import { keys, useWorkspacesQuery } from "../../../../lib/hooks";
import {
  createCustomField,
  createLabel,
  createStatus,
  deleteCustomField,
  deleteLabel,
  deleteStatus,
  updateWorkspace,
} from "../../../../lib/api/workspaces";
import { createProject } from "../../../../lib/api/projects";
import { colors } from "../../../../lib/theme";

const PALETTE = ["#8b7cf7", "#ef6b5c", "#e8b54a", "#4caf7a", "#5aa7ff", "#f472b6"];

export default function WorkspaceEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useQueryClient();
  const workspace = (useWorkspacesQuery().data ?? []).find((w) => w.id === id);
  const [name, setName] = useState(workspace?.name ?? "");
  const [statusName, setStatusName] = useState("");
  const [labelName, setLabelName] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);

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
        <Field value={labelName} onChangeText={setLabelName} placeholder="New label" autoCapitalize="words" />
        <PrimaryButton
          label="Add label"
          disabled={!labelName.trim()}
          onPress={async () => {
            await createLabel(workspace.id, { name: labelName.trim(), color });
            setLabelName("");
            await refresh();
          }}
        />

        <SectionLabel>Custom fields</SectionLabel>
        {(workspace.customFields ?? []).map((f) => (
          <View key={f.id} style={styles.row}>
            <Text style={styles.item}>{f.name} · {f.type}</Text>
            <Pressable onPress={async () => { await deleteCustomField(workspace.id, f.id); await refresh(); }}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        ))}
        <SectionLabel>Projects</SectionLabel>
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

        <Field value={fieldName} onChangeText={setFieldName} placeholder="New text field" autoCapitalize="words" />
        <PrimaryButton
          label="Add text field"
          disabled={!fieldName.trim()}
          onPress={async () => {
            await createCustomField(workspace.id, { name: fieldName.trim(), type: "text" });
            setFieldName("");
            await refresh();
          }}
        />
      </ScrollView>
    </Screen>
  );
}

function ColorRow({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {PALETTE.map((c) => (
        <Pressable key={c} onPress={() => onChange(c)} style={[styles.swatch, { backgroundColor: c, borderColor: value === c ? colors.foreground : "transparent" }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  item: { flex: 1, color: colors.foreground },
  remove: { color: colors.destructive, fontSize: 13 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2 },
});
