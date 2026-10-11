import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link, Redirect, useRouter } from "expo-router";
import { AUTH, AuthButton, AuthField, AuthLink, AuthNotice, AuthScreen, NowBlock } from "../components/auth/AuthKit";
import { isOnboarded, useAuth } from "../lib/auth/AuthProvider";
import { useServer } from "../lib/server/ServerProvider";

export default function LoginScreen() {
  const { token, user, login } = useAuth();
  const server = useServer();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (server.status === "unconfigured") return <Redirect href="/connect" />;
  if (token && isOnboarded(user)) return <Redirect href="/(app)/(tabs)/home" />;
  if (token && user) return <Redirect href="/onboarding" />;

  async function submit() {
    if (!email.trim() || !password.trim()) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const next = await login(email.trim(), password);
      router.replace(isOnboarded(next) ? "/(app)/(tabs)/home" : "/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthScreen
      block={<NowBlock label="Sign in" />}
      title={"Pick up where\nyou left off."}
      lead="Your week is where you left it, with the assistant ready when you are."
      headerAction={
        <Link href="/signup" asChild>
          <Pressable accessibilityRole="link" style={styles.headerLink}>
            <Text style={styles.headerLinkText}>Register</Text>
          </Pressable>
        </Link>
      }
    >
      {error ? <AuthNotice>{error}</AuthNotice> : null}
      <AuthField
        testID="login-email"
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
      />
      <AuthField
        testID="login-password"
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={() => void submit()}
      />
      <View style={styles.actions}>
        <AuthButton
          testID="login-submit"
          label={pending ? "Signing in…" : "Sign in"}
          pending={pending}
          disabled={pending}
          onPress={() => void submit()}
        />
      </View>
      <AuthLink label="New to Timely? Create an account" tone="now" onPress={() => router.push("/signup")} />
      <Link href="/connect?mode=change" asChild>
        <Pressable accessibilityRole="button" accessibilityLabel="Change server" style={styles.server}>
          <View style={styles.serverDot} />
          <Text style={styles.serverText} numberOfLines={2}>
            {server.name ? `${server.name} · ` : ""}
            {server.activeUrl}
          </Text>
          <Text style={styles.serverChange}>Change</Text>
        </Pressable>
      </Link>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  headerLink: {
    borderWidth: 1,
    borderColor: AUTH.lineStrong,
    backgroundColor: AUTH.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  headerLinkText: { color: AUTH.ink, fontSize: 14, fontWeight: "600" },
  actions: { marginTop: 6 },
  server: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: AUTH.lineStrong,
    paddingTop: 14,
  },
  serverDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: AUTH.green },
  serverText: { flex: 1, color: AUTH.soft, fontFamily: AUTH.mono, fontSize: 11 },
  serverChange: { color: AUTH.now, fontSize: 13, fontWeight: "600" },
});
