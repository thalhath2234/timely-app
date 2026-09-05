import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link, Redirect, useRouter } from "expo-router";
import Screen from "../components/ui/Screen";
import { Field, PrimaryButton } from "../components/ui/primitives";
import { isOnboarded, useAuth } from "../lib/auth/AuthProvider";
import { colors } from "../lib/theme";

export default function LoginScreen() {
  const { token, user, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (token && isOnboarded(user)) return <Redirect href="/(app)/(tabs)/calendar" />;
  if (token) return <Redirect href="/onboarding" />;

  async function submit() {
    if (!email.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const next = await login(email.trim(), password);
      router.replace(isOnboarded(next) ? "/(app)/(tabs)/calendar" : "/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Screen padded>
      <View style={styles.wrap}>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.sub}>Sign in to manage your schedule with Timely</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Field
          testID="login-email"
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          keyboardType="email-address"
        />
        <Field testID="login-password" value={password} onChangeText={setPassword} placeholder="Password" secure />
        <PrimaryButton
          testID="login-submit"
          label={pending ? "Signing in…" : "Sign in"}
          disabled={pending}
          onPress={() => void submit()}
        />
        <Link href="/signup" asChild>
          <Pressable>
            <Text style={styles.link}>Need an account? Create one</Text>
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
