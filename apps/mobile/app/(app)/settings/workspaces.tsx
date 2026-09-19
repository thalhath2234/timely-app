import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
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
      <ScrollView contentContainerStyle={{ padding: 12, gap: 8 }}>
        {spaces.map((w) => (
          <AnimatedPressable key={w.id} onPress={() => router.push(`/(app)/settings/workspace/${w.id}`)} style={styles.card}>
            <Text style={styles.title}>{w.name}</Text>
            <Text style={styles.meta}>
              {(w.status ?? []).length} statuses · {(w.lables ?? []).length} labels · {(w.customFields ?? []).length}{" "}
              fields
            </Text>
          </AnimatedPressable>
        ))}
        <View style={{ height: 8 }} />
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
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 14,
  },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 4 },
}));
