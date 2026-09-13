import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { Field, PrimaryButton } from "../../../components/ui/primitives";
import { useAuth } from "../../../lib/auth/AuthProvider";
import { updateMe } from "../../../lib/api/auth";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

export default function AccountSettings() {
  const { user, refresh } = useAuth();
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
      </View>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { padding: 16, gap: 12 },
  msg: { color: colors.mutedForeground, fontSize: 13 },
}));
