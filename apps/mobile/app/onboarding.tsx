import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import Screen from "../components/ui/Screen";
import { Field, PrimaryButton } from "../components/ui/primitives";
import { isOnboarded, useAuth } from "../lib/auth/AuthProvider";
import { colors, createThemedStyleSheet } from "../lib/theme";

export default function OnboardingScreen() {
  const { token, user, finishOnboarding } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!token) return <Redirect href="/login" />;
  if (!user) return <Redirect href="/login" />;
  if (isOnboarded(user)) return <Redirect href="/(app)/(tabs)/home" />;

  async function submit() {
    if (name.trim().length < 2) {
      setError("Workspace name must be at least 2 characters.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await finishOnboarding(name.trim());
      router.replace("/(app)/(tabs)/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish setup");
    } finally {
      setPending(false);
    }
  }

  return (
    <Screen padded>
      <View style={styles.wrap}>
        <Text style={styles.title}>Name your workspace</Text>
        <Text style={styles.sub}>This is the home for your tasks, docs, and calendar.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Field value={name} onChangeText={setName} placeholder="Personal, Studio, …" autoCapitalize="words" />
        <PrimaryButton label={pending ? "Creating…" : "Continue"} disabled={pending} onPress={() => void submit()} />
      </View>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { flex: 1, justifyContent: "center", gap: 12 },
  title: { color: colors.foreground, fontSize: 28, fontWeight: "600" },
  sub: { color: colors.mutedForeground, fontSize: 14, marginBottom: 8 },
  error: { color: colors.destructive, fontSize: 13 },
}));
