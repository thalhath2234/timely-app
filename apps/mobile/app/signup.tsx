import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link, Redirect, useRouter } from "expo-router";
import { AUTH, AuthButton, AuthField, AuthLink, AuthNotice, AuthScreen, NowBlock } from "../components/auth/AuthKit";
import { DAY_COLORS } from "../lib/authDay";
import { isOnboarded, useAuth } from "../lib/auth/AuthProvider";
import { useServer } from "../lib/server/ServerProvider";

function LoginLink() {
  return (
    <Link href="/login" asChild>
      <Pressable accessibilityRole="link" style={styles.headerLink}>
        <Text style={styles.headerLinkText}>Log in</Text>
      </Pressable>
    </Link>
  );
}

export default function SignupScreen() {
  const { token, user, signup } = useAuth();
  const server = useServer();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (server.status === "unconfigured") return <Redirect href="/connect" />;
  if (token && isOnboarded(user)) return <Redirect href="/(app)/(tabs)/home" />;
  if (token) return <Redirect href="/onboarding" />;

  if (server.health?.registrationOpen === false) {
    return (
      <AuthScreen
        block={<NowBlock label="Sign-ups closed" color={DAY_COLORS.red} />}
        title={"New accounts are\nturned off here."}
        lead="This Timely already has its owner, and only the first account can sign up on its own. If this is your Timely, sign in."
        headerAction={<LoginLink />}
      >
        <AuthButton label="Sign in" onPress={() => router.replace("/login")} />
        <Text style={styles.closedNote}>
          To let someone else join, the owner turns on Allow new accounts in Settings, Server in the desktop app, or sets
          ALLOW_REGISTRATION=true on a self-hosted server.
        </Text>
      </AuthScreen>
    );
  }

  async function submit() {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError("Fill in your name, email and a password.");
      return;
    }
    if (password.length < 8) {
      setError("Use a password of at least 8 characters.");
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
    <AuthScreen
      block={<NowBlock label="Create your account" />}
      title="Start your first day."
      lead="Your tasks, docs and keys stay on this server, and the assistant runs on the AI you already pay for."
      headerAction={<LoginLink />}
    >
      {error ? <AuthNotice>{error}</AuthNotice> : null}
      <AuthField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Sam Rivera"
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
      />
      <AuthField
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
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        hint="At least 8 characters."
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={() => void submit()}
      />
      <View style={styles.actions}>
        <AuthButton
          label={pending ? "Creating account…" : "Create account"}
          pending={pending}
          disabled={pending}
          onPress={() => void submit()}
        />
      </View>
      <AuthLink label="Already have an account? Sign in" tone="now" onPress={() => router.replace("/login")} />
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
  closedNote: { color: AUTH.soft, fontSize: 13, lineHeight: 20, marginTop: 6 },
});
