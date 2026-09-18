import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Field, PrimaryButton, SectionLabel } from "../../../components/ui/primitives";
import ConfirmSheet, { type ConfirmRequest } from "../../../components/ui/ConfirmSheet";
import { useAuth } from "../../../lib/auth/AuthProvider";
import { updateMe } from "../../../lib/api/auth";
import { useRevokeOtherSessions, useRevokeSession, useSessionsQuery } from "../../../lib/hooks";
import { formatLastUsed, humanizeDeviceLabel } from "../../../lib/deviceLabel";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

export default function AccountSettings() {
  const router = useRouter();
  const { user, refresh, logout } = useAuth();
  const sessions = useSessionsQuery();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  async function save() {
    setPending(true);
    setMessage("");
    try {
      await updateMe({
        name,
        email,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      await refresh();
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Saved");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  const others = (sessions.data ?? []).filter((item) => !item.current).length;

  return (
    <Screen>
      <MobileHeader title="Account" back large={false} />
      <View style={styles.wrap}>
        <Field value={name} onChangeText={setName} placeholder="Name" autoCapitalize="words" />
        <Field value={email} onChangeText={setEmail} placeholder="Email" />
        <Field value={currentPassword} onChangeText={setCurrentPassword} placeholder="Current password" secure />
        <Field value={newPassword} onChangeText={setNewPassword} placeholder="New password" secure />
        {message ? <Text style={styles.msg}>{message}</Text> : null}
        <PrimaryButton label={pending ? "Saving…" : "Save account"} disabled={pending} onPress={() => void save()} />

        <SectionLabel>Devices</SectionLabel>
        <Text style={styles.msg}>Sign out a device if you no longer use it.</Text>
        {others > 0 ? (
          <Pressable
            onPress={() =>
              setConfirm({
                title: "Sign out other devices?",
                message: "This device stays signed in.",
                confirmLabel: "Sign out others",
                onConfirm: () => revokeOthers.mutate(),
              })
            }
          >
            <Text style={styles.destructive}>
              {revokeOthers.isPending ? "Signing out…" : `Sign out everywhere else (${others})`}
            </Text>
          </Pressable>
        ) : null}
        {(sessions.data ?? []).map((session) => (
          <View key={session.id} style={[styles.device, session.current && styles.current]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.deviceName}>
                {humanizeDeviceLabel(session.deviceLabel)}
                {session.current ? " · This device" : ""}
              </Text>
              <Text style={styles.msg}>Last used {formatLastUsed(session.lastUsedAt)}</Text>
            </View>
            <Pressable
              onPress={() =>
                setConfirm({
                  title: session.current ? "Sign out this device?" : "Sign out device?",
                  confirmLabel: "Sign out",
                  onConfirm: () => {
                    void revoke.mutateAsync(session.id).then(() => {
                      if (session.current) {
                        void logout().then(() => router.replace("/login"));
                      }
                    });
                  },
                })
              }
            >
              <Text style={styles.destructive}>{revoke.isPending ? "…" : "Sign out"}</Text>
            </Pressable>
          </View>
        ))}
      </View>
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
  wrap: { padding: 16, gap: 12 },
  msg: { color: colors.mutedForeground, fontSize: 13 },
  device: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
  },
  current: { borderColor: colors.primary },
  deviceName: { color: colors.foreground, fontWeight: "600" },
  destructive: { color: colors.destructive, fontWeight: "600", fontSize: 13 },
}));
