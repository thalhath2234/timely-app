import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Layers3, Plus } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Button, Field, FieldLabel } from "../../../components/ui/primitives";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { keys, useWorkspacesQuery } from "../../../lib/hooks";
import { createWorkspace } from "../../../lib/api/workspaces";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

export default function WorkspacesSettings() {
  const router = useRouter();
  const client = useQueryClient();
  const spaces = useWorkspacesQuery().data ?? [];
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <Screen>
      <MobileHeader title="Workspaces" back />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Text style={styles.intro}>Organize work by space. Open one to manage its statuses, labels, fields, and projects.</Text>
        {spaces.map((w) => (
          <AnimatedPressable key={w.id} onPress={() => router.push(`/(app)/settings/workspace/${w.id}`)} style={styles.card}>
            <View style={styles.icon}><Layers3 size={18} color={colors.accentForeground} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{w.name}</Text>
              <Text style={styles.meta}>
                {(w.status ?? []).length} statuses · {(w.lables ?? []).length} labels · {(w.customFields ?? []).length} fields
              </Text>
            </View>
            <ChevronRight size={18} color={colors.mutedForeground} />
          </AnimatedPressable>
        ))}
        <FieldLabel>New workspace</FieldLabel>
        <View style={styles.createRow}>
          <View style={{ flex: 1 }}>
            <Field value={name} onChangeText={setName} placeholder="Workspace name" autoCapitalize="words" />
          </View>
          <Button
            label="Create"
            size="lg"
            icon={<Plus size={16} color={colors.primaryForeground} />}
            loading={pending}
            disabled={!name.trim()}
            onPress={async () => {
              setPending(true);
              try {
                await createWorkspace({ name: name.trim() });
                setName("");
                await client.invalidateQueries({ queryKey: keys.workspaces });
              } finally {
                setPending(false);
              }
            }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  intro: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  createRow: { flexDirection: "row", alignItems: "center", gap: 8 },
}));
