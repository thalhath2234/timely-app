import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Field, PrimaryButton } from "../../../components/ui/primitives";
import ConfirmSheet, { type ConfirmRequest } from "../../../components/ui/ConfirmSheet";
import { useApiKeysQuery, useCreateApiKey, useRevokeApiKey } from "../../../lib/hooks";
import { timeAgo } from "../../../lib/format";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

export default function ApiKeysSettings() {
  const keysQ = useApiKeysQuery();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  return (
    <Screen>
      <MobileHeader title="API keys" back large={false} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <Text style={styles.hint}>Copy a new key immediately. It is only shown once.</Text>
        {secret ? (
          <View style={styles.secret}>
            <Text style={styles.secretText}>{secret}</Text>
          </View>
        ) : null}
        {(keysQ.data ?? []).map((key) => (
          <View key={key.id} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{key.name}</Text>
              <Text style={styles.meta}>{key.prefix}… · {timeAgo(key.createdAt)}</Text>
            </View>
            <Pressable
              onPress={() =>
                setConfirm({
                  title: "Revoke key?",
                  message: key.name,
                  confirmLabel: "Revoke",
                  onConfirm: () => revoke.mutate(key.id),
                })
              }
            >
              <Text style={styles.revoke}>Revoke</Text>
            </Pressable>
          </View>
        ))}
        <Field value={name} onChangeText={setName} placeholder="Key name" autoCapitalize="words" />
        <PrimaryButton
          label={create.isPending ? "Creating…" : "Create key"}
          disabled={!name.trim() || create.isPending}
          onPress={() =>
            create.mutate(name.trim(), {
              onSuccess: (created) => {
                setSecret(created.key);
                setName("");
              },
            })
          }
        />
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
  hint: { color: colors.mutedForeground, fontSize: 13 },
  secret: { borderRadius: 12, backgroundColor: colors.accent, padding: 12 },
  secretText: { color: colors.accentForeground, fontFamily: "monospace" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  title: { color: colors.foreground, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  revoke: { color: colors.destructive, fontWeight: "600" },
}));
