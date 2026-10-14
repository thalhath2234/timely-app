import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Button, Field, PrimaryButton } from "../../../components/ui/primitives";
import ConfirmSheet, { type ConfirmRequest } from "../../../components/ui/ConfirmSheet";
import { useApiKeysQuery, useCreateApiKey, useRevokeApiKey } from "../../../lib/hooks";
import { timeAgo } from "../../../lib/format";
import { useToastStore } from "../../../lib/toast";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { FocusGroup, FocusGroupScrollView } from "../../../components/ui/FocusGroup";

export default function ApiKeysSettings() {
  const keysQ = useApiKeysQuery();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [name, setName] = useState("");
  // The full key of the one just created; the server never returns it again.
  const [secret, setSecret] = useState<{ id: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  return (
    <Screen>
      <MobileHeader title="API keys" back large={false} />
      <FocusGroupScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <Text style={styles.hint}>API keys let Hermes and other MCP clients use your Timely data. A new key is shown only once.</Text>
        {secret ? (
          <View style={styles.secret}>
            <Text style={styles.secretLabel}>Copy this key now. It won’t be shown again.</Text>
            <Text selectable style={styles.secretText} testID="api-key-secret">
              {secret.key}
            </Text>
            <View style={styles.secretActions}>
              <Button
                label={copied ? "Copied" : "Copy key"}
                variant="outline"
                size="sm"
                icon={copied ? <Check size={16} color={colors.foreground} /> : <Copy size={16} color={colors.foreground} />}
                onPress={() => {
                  void Clipboard.setStringAsync(secret.key).then(
                    () => setCopied(true),
                    () => useToastStore.getState().show("Couldn’t copy the key. Select it and copy it instead."),
                  );
                }}
              />
            </View>
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
                  onConfirm: () =>
                    revoke.mutate(key.id, {
                      // A revoked key no longer works: stop showing its secret.
                      onSuccess: () => setSecret((shown) => (shown?.id === key.id ? null : shown)),
                    }),
                })
              }
            >
              <Text style={styles.revoke}>Revoke</Text>
            </Pressable>
          </View>
        ))}
        <FocusGroup style={{ gap: 10 }}>
          <Field value={name} onChangeText={setName} placeholder="Key name" autoCapitalize="words" />
          <PrimaryButton
            label={create.isPending ? "Creating…" : "Create key"}
            disabled={!name.trim() || create.isPending}
            onPress={() =>
              create.mutate(name.trim(), {
                onSuccess: (created) => {
                  setSecret({ id: created.id, key: created.key });
                  setCopied(false);
                  setName("");
                },
              })
            }
          />
        </FocusGroup>
      </FocusGroupScrollView>
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
  secret: { borderRadius: 12, backgroundColor: colors.accent, padding: 12, gap: 8 },
  secretLabel: { color: colors.accentForeground, fontSize: 13, fontWeight: "500" },
  secretText: { color: colors.accentForeground, fontFamily: "monospace", fontSize: 13, userSelect: "text" },
  secretActions: { flexDirection: "row" },
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
