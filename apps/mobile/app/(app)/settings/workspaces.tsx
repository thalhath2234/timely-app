import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Layers3, Plus } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Field, PrimaryButton } from "../../../components/ui/primitives";
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
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>Your workspaces</Text>
        <Text style={styles.intro}>Organize work by space. Open one to manage its statuses, labels, fields, and projects.</Text>
        {spaces.map((w) => (
          <AnimatedPressable key={w.id} onPress={() => router.push(`/(app)/settings/workspace/${w.id}`)} style={styles.card}>
            <View style={styles.icon}><Layers3 size={20} color={colors.accentForeground} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{w.name}</Text>
              <Text style={styles.meta}>
                {(w.status ?? []).length} statuses · {(w.lables ?? []).length} labels · {(w.customFields ?? []).length} fields
              </Text>
            </View>
            <ChevronRight size={18} color={colors.mutedForeground} />
          </AnimatedPressable>
        ))}
        <View style={styles.createCard}>
          <View style={styles.createHeader}>
            <Plus size={18} color={colors.accentForeground} />
            <Text style={styles.createTitle}>Create workspace</Text>
          </View>
          <Field value={name} onChangeText={setName} placeholder="New workspace name" autoCapitalize="words" />
          <PrimaryButton
            label={pending ? "Creating…" : "Create workspace"}
            disabled={!name.trim() || pending}
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
  heading: { color: colors.foreground, fontSize: 22, fontWeight: "700" },
  intro: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 76,
    borderRadius: 20,
    backgroundColor: colors.card,
    padding: 16,
  },
  icon: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  title: { color: colors.foreground, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 4 },
  createCard: { borderRadius: 24, backgroundColor: colors.card, padding: 16, gap: 12, marginTop: 12 },
  createHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  createTitle: { color: colors.foreground, fontSize: 16, fontWeight: "700" },
}));
