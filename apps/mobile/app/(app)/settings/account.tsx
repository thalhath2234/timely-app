import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Field, PrimaryButton, SectionLabel } from "../../../components/ui/primitives";
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
              Alert.alert("Sign out other devices?", "This device stays signed in.", [
                { text: "Cancel", style: "cancel" },
                { text: "Sign out others", style: "destructive", onPress: () => revokeOthers.mutate() },
              ])
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
                Alert.alert(session.current ? "Sign out this device?" : "Sign out device?", undefined, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Sign out",
                    style: "destructive",
                    onPress: () => {
                      void revoke.mutateAsync(session.id).then(() => {
                        if (session.current) {
                          void logout().then(() => router.replace("/login"));
                        }
                      });
                    },
                  },
                ])
              }
            >
              <Text style={styles.destructive}>{revoke.isPending ? "…" : "Sign out"}</Text>
            </Pressable>
          </View>
        ))}
      </View>
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
