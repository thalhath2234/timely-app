import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link, Redirect, useRouter } from "expo-router";
import Screen from "../components/ui/Screen";
import { Field, PrimaryButton } from "../components/ui/primitives";
import { isOnboarded, useAuth } from "../lib/auth/AuthProvider";
import { colors } from "../lib/theme";

export default function SignupScreen() {
  const { token, user, signup } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (token && isOnboarded(user)) return <Redirect href="/(app)/(tabs)/calendar" />;
  if (token) return <Redirect href="/onboarding" />;

  async function submit() {
    if (!name.trim() || !email.trim() || password.trim().length < 8) {
      setError("Use your name, a valid email, and a password of at least 8 characters.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await signup(name.trim(), email.trim(), password);
      router.replace("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Screen padded>
      <View style={styles.wrap}>
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.sub}>Start planning in Timely</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Field value={name} onChangeText={setName} placeholder="Full name" autoCapitalize="words" />
        <Field value={email} onChangeText={setEmail} placeholder="Email" />
        <Field value={password} onChangeText={setPassword} placeholder="Password (min 8 characters)" secure />
        <PrimaryButton label={pending ? "Creating…" : "Create account"} disabled={pending} onPress={() => void submit()} />
        <Link href="/login" asChild>
          <Pressable>
            <Text style={styles.link}>Already have an account? Sign in</Text>
          </Pressable>
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", gap: 12 },
  title: { color: colors.foreground, fontSize: 28, fontWeight: "600" },
  sub: { color: colors.mutedForeground, fontSize: 14, marginBottom: 8 },
  error: { color: colors.destructive, fontSize: 13 },
  link: { color: colors.primary, textAlign: "center", marginTop: 8 },
});
