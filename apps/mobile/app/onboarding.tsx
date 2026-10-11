import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Screen from "../components/ui/Screen";
import AnimatedPressable from "../components/ui/AnimatedPressable";
import { Chip, Field, PrimaryButton } from "../components/ui/primitives";
import { isOnboarded, useAuth } from "../lib/auth/AuthProvider";
import { createWorkspace } from "../lib/api/workspaces";
import { applyStarterLabels, getPersonalPrefs, getStarterPresets, savePersonalUseCase } from "../lib/api/decisions";
import { createThemedStyleSheet } from "../lib/theme";

export default function OnboardingScreen() {
  const { token, user, finishOnboarding } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  // Step 1 asks what Timely is for and offers starter labels from a fixed
  // catalog (no smart suggestions needed); step 2 names the workspace.
  const [step, setStep] = useState<1 | 2>(1);
  const [uses, setUses] = useState<string[]>([]);
  const [unpicked, setUnpicked] = useState<Set<string>>(new Set());
  // Starter workspaces: each picked use offers a workspace name; the first
  // can name this workspace and the others can be created alongside it.
  const [alsoCreate, setAlsoCreate] = useState<Set<string>>(new Set());
  const ready = Boolean(token && user && !isOnboarded(user));
  const personal = useQuery({ queryKey: ["personal-prefs"], queryFn: getPersonalPrefs, enabled: ready, retry: false });
  const presets = useQuery({
    queryKey: ["starter-presets", uses.join(",")],
    queryFn: () => getStarterPresets(uses),
    enabled: ready && uses.length > 0,
    retry: false,
  });

  if (!token) return <Redirect href="/login" />;
  if (!user) return <Redirect href="/login" />;
  if (isOnboarded(user)) return <Redirect href="/(app)/(tabs)/home" />;

  const useOptions = personal.data?.uses ?? [];
  const starter = uses.length > 0 ? (presets.data?.labels ?? []) : [];
  const chosen = starter.filter((label) => !unpicked.has(label.name));
  const starterWorkspaces = [
    ...new Set(useOptions.filter((u) => uses.includes(u.key) && u.workspace).map((u) => u.workspace as string)),
  ];
  const others = starterWorkspaces.filter((n) => n.toLowerCase() !== name.trim().toLowerCase());
  const extra = others.filter((n) => alsoCreate.has(n));
  const toggleAlso = (n: string) =>
    setAlsoCreate((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const toggleUse = (key: string) => setUses((prev) => (prev.includes(key) ? prev.filter((u) => u !== key) : [...prev, key]));
  const toggleLabel = (label: string) =>
    setUnpicked((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  async function submit() {
    if (name.trim().length < 2) {
      setError("Workspace name must be at least 2 characters.");
      return;
    }
    setPending(true);
    setError("");
    const useCase = useOptions.filter((u) => uses.includes(u.key)).map((u) => u.label).join(", ");
    try {
      // Starter labels and the use case are extras: a failure never blocks
      // finishing setup.
      await finishOnboarding(name.trim(), async (workspaceId) => {
        if (useCase) await savePersonalUseCase(useCase).catch(() => undefined);
        if (chosen.length) await applyStarterLabels(workspaceId, chosen).catch(() => undefined);
        for (const extraName of extra) await createWorkspace({ name: extraName }).catch(() => undefined);
      });
      router.replace("/(app)/(tabs)/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish setup");
    } finally {
      setPending(false);
    }
  }

  if (step === 1) {
    return (
      <Screen padded>
        <ScrollView contentContainerStyle={styles.scroll} testID="onboarding-uses">
          <Text style={styles.step}>Step 1 of 2</Text>
          <Text style={styles.title}>What will you use Timely for?</Text>
          <Text style={styles.sub}>Pick any that fit. Timely sets up a few labels to match.</Text>
          <View style={styles.chips}>
            {useOptions.map((u) => (
              <Chip key={u.key} label={u.label} active={uses.includes(u.key)} onPress={() => toggleUse(u.key)} />
            ))}
          </View>
          {starter.length ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.label}>Starter labels</Text>
              <View style={styles.chips}>
                {starter.map((label) => (
                  <Chip
                    key={label.name}
                    label={label.name}
                    color={label.color}
                    active={!unpicked.has(label.name)}
                    onPress={() => toggleLabel(label.name)}
                  />
                ))}
              </View>
              <Text style={styles.hint}>Tap a label to leave it out. You can edit labels later in settings.</Text>
            </View>
          ) : null}
          <PrimaryButton
            label="Continue"
            disabled={uses.length === 0}
            onPress={() => {
              if (!name.trim() && starterWorkspaces[0]) setName(starterWorkspaces[0]);
              setStep(2);
            }}
          />
          <AnimatedPressable
            accessibilityRole="button"
            onPress={() => {
              setUses([]);
              setStep(2);
            }}
            style={styles.link}
          >
            <Text style={styles.linkText}>Skip</Text>
          </AnimatedPressable>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen padded>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.step}>Step 2 of 2</Text>
        <Text style={styles.title}>Name your workspace</Text>
        <Text style={styles.sub}>This is the home for your tasks, docs, and calendar.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Field value={name} onChangeText={setName} placeholder="Personal, Studio, …" autoCapitalize="words" />
        {starterWorkspaces.length ? (
          <View style={{ gap: 8 }} testID="starter-workspaces">
            <Text style={styles.label}>Suggested names</Text>
            <View style={styles.chips}>
              {starterWorkspaces.map((n) => (
                <Chip key={n} label={n} active={name.trim() === n} onPress={() => setName(n)} />
              ))}
            </View>
            {others.length ? (
              <>
                <Text style={styles.label}>Also create</Text>
                <View style={styles.chips}>
                  {others.map((n) => (
                    <Chip key={n} label={`${n} workspace`} active={alsoCreate.has(n)} onPress={() => toggleAlso(n)} />
                  ))}
                </View>
              </>
            ) : null}
          </View>
        ) : null}
        <PrimaryButton label={pending ? "Creating…" : "Continue"} disabled={pending} onPress={() => void submit()} />
        {chosen.length || extra.length ? (
          <Text style={[styles.hint, { textAlign: "center" }]}>
            {[
              chosen.length ? `Adds ${chosen.length} starter label${chosen.length === 1 ? "" : "s"}` : "",
              extra.length ? `${chosen.length ? "and" : "Adds"} ${extra.length} more workspace${extra.length === 1 ? "" : "s"}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
          </Text>
        ) : null}
        <AnimatedPressable accessibilityRole="button" disabled={pending} onPress={() => setStep(1)} style={styles.link}>
          <Text style={styles.linkText}>Back</Text>
        </AnimatedPressable>
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  scroll: { flexGrow: 1, justifyContent: "center", gap: 14, paddingVertical: 24 },
  step: { color: colors.primary, fontSize: 12, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" },
  title: { color: colors.foreground, fontSize: 28, fontWeight: "600" },
  sub: { color: colors.mutedForeground, fontSize: 14, marginBottom: 8 },
  label: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8 },
  hint: { color: colors.mutedForeground, fontSize: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  error: { color: colors.destructive, fontSize: 13 },
  link: { alignSelf: "center", padding: 8 },
  linkText: { color: colors.mutedForeground, fontSize: 14 },
}));
