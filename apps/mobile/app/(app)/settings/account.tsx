import { useState } from "react";
import { Text, View } from "react-native";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { useRouter } from "expo-router";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Field, PrimaryButton } from "../../../components/ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../../../components/settings/SettingsList";
import ConfirmSheet, { type ConfirmRequest } from "../../../components/ui/ConfirmSheet";
import { useAuth } from "../../../lib/auth/AuthProvider";
import { updateMe } from "../../../lib/api/auth";
import { useRevokeOtherSessions, useRevokeSession, useSessionsQuery } from "../../../lib/hooks";
import { formatLastUsed, humanizeDeviceLabel } from "../../../lib/deviceLabel";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { FocusGroup, FocusGroupScrollView } from "../../../components/ui/FocusGroup";

const DEVICES_SHOWN = 5;

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
  const [showAll, setShowAll] = useState(false);

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
  // This device first, then the most recently used.
  const devices = [...(sessions.data ?? [])].sort((a, b) =>
    a.current === b.current ? String(b.lastUsedAt ?? "").localeCompare(String(a.lastUsedAt ?? "")) : a.current ? -1 : 1,
  );
  const shown = showAll ? devices : devices.slice(0, DEVICES_SHOWN);

  return (
    <Screen>
      <MobileHeader title="Account" back large={false} />
      <FocusGroupScrollView contentContainerStyle={styles.wrap}>
        <FocusGroup style={{ gap: 12 }}>
          <ListGroup>
            <ListRow
              title="Name"
              trailing={
                <View style={styles.inline}>
                  <Field bare value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
                </View>
              }
            />
            <ListRow
              title="Email"
              trailing={
                <View style={styles.inline}>
                  <Field bare value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
                </View>
              }
            />
          </ListGroup>
          <GroupLabel>Change password</GroupLabel>
          <ListGroup>
            <ListRow
              title="Current"
              trailing={
                <View style={styles.inline}>
                  <Field bare value={currentPassword} onChangeText={setCurrentPassword} placeholder="Current password" secure />
                </View>
              }
            />
            <ListRow
              title="New"
              trailing={
                <View style={styles.inline}>
                  <Field bare value={newPassword} onChangeText={setNewPassword} placeholder="New password" secure />
                </View>
              }
            />
          </ListGroup>
          <GroupHint>Leave both blank to keep your password.</GroupHint>
          {message ? <Text style={styles.msg}>{message}</Text> : null}
          <PrimaryButton label={pending ? "Saving…" : "Save account"} disabled={pending} onPress={() => void save()} />
        </FocusGroup>

        <GroupLabel
          aside={
            others > 0 ? (
              <AnimatedPressable
                accessibilityRole="button"
                hitSlop={8}
                disabled={revokeOthers.isPending}
                onPress={() =>
                  setConfirm({
                    title: "Sign out other devices?",
                    message: "This device stays signed in.",
                    confirmLabel: "Sign out others",
                    onConfirm: () => revokeOthers.mutate(),
                  })
                }
              >
                <Text style={styles.headingAction}>{revokeOthers.isPending ? "Signing out…" : `Sign out ${others} others`}</Text>
              </AnimatedPressable>
            ) : undefined
          }
        >
          {devices.length ? `Devices · ${devices.length}` : "Devices"}
        </GroupLabel>
        <ListGroup>
          {shown.map((session) => (
            <View key={session.id} style={styles.device}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.deviceTitle}>
                  <Text numberOfLines={1} style={styles.deviceName}>
                    {humanizeDeviceLabel(session.deviceLabel)}
                  </Text>
                  {session.current ? <Text style={styles.badge}>This device</Text> : null}
                </View>
                <Text style={styles.msg}>Last used {formatLastUsed(session.lastUsedAt)}</Text>
              </View>
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel={`Sign out ${humanizeDeviceLabel(session.deviceLabel)}`}
                hitSlop={8}
                disabled={revoke.isPending}
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
                <Text style={styles.signOut}>Sign out</Text>
              </AnimatedPressable>
            </View>
          ))}
          {devices.length > DEVICES_SHOWN ? (
            <ListRow
              title={showAll ? "Show fewer" : `Show all ${devices.length}`}
              tone="add"
              leading={showAll ? <ChevronUp size={18} color={colors.primary} /> : <ChevronDown size={18} color={colors.primary} />}
              onPress={() => setShowAll(!showAll)}
            />
          ) : null}
        </ListGroup>
        <GroupHint>Sign out a device if you no longer use it.</GroupHint>
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
  wrap: { padding: 16, gap: 12 },
  msg: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  inline: { width: 228 },
  headingAction: { color: colors.destructive, fontSize: 13, fontWeight: "600" },
  device: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  deviceTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  deviceName: { flexShrink: 1, color: colors.foreground, fontSize: 15, fontWeight: "500" },
  badge: {
    color: colors.accentForeground,
    backgroundColor: colors.accent,
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  signOut: { color: colors.destructive, fontSize: 13, fontWeight: "600" },
}));
