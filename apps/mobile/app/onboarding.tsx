import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  AUTH,
  AuthButton,
  AuthField,
  AuthLink,
  AuthNotice,
  AuthScreen,
  ChoiceChip,
  DayPreview,
  NowBlock,
  SectionLabel,
} from "../components/auth/AuthKit";
import { DAY_COLORS, onboardingDay } from "../lib/authDay";
import { isOnboarded, useAuth } from "../lib/auth/AuthProvider";
import { createWorkspace } from "../lib/api/workspaces";
import { applyStarterLabels, getPersonalPrefs, getStarterPresets, savePersonalUseCase } from "../lib/api/decisions";

export default function OnboardingScreen() {
  const { token, user, finishOnboarding, logout } = useAuth();
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

  const signedIn = user.email ? (
    <View style={styles.signedIn}>
      <Text style={styles.signedInText} numberOfLines={1}>
        Signed in as <Text style={{ color: AUTH.ink }}>{user.email}</Text>
      </Text>
      <AuthLink
        label="Sign out"
        onPress={() => {
          void logout().then(() => router.replace("/login"));
        }}
      />
    </View>
  ) : null;

  if (step === 1) {
    return (
      <AuthScreen
        contentKey="uses"
        block={<NowBlock label="Step 1 of 2 · What it’s for" />}
        title="What fills your days?"
        lead="Pick any that fit. Timely adds a few labels to match."
      >
        <View style={styles.chips} testID="onboarding-uses">
          {useOptions.map((u) => (
            <ChoiceChip key={u.key} label={u.label} pressed={uses.includes(u.key)} onPress={() => toggleUse(u.key)} />
          ))}
        </View>
        {starter.length ? (
          <>
            <SectionLabel>Starter labels</SectionLabel>
            <View style={styles.chips}>
              {starter.map((label) => {
                const on = !unpicked.has(label.name);
                return (
                  <ChoiceChip
                    key={label.name}
                    label={label.name}
                    color={label.color}
                    pressed={on}
                    off={!on}
                    onPress={() => toggleLabel(label.name)}
                  />
                );
              })}
            </View>
            <Text style={styles.hint}>Tap a label to leave it out. You can edit labels later in Settings.</Text>
          </>
        ) : null}
        {chosen.length ? (
          <DayPreview title="Your first day" tabs={starterWorkspaces} blocks={onboardingDay(chosen, 3)} />
        ) : null}
        <View style={styles.actions}>
          <AuthButton
            label="Continue"
            disabled={uses.length === 0}
            onPress={() => {
              if (!name.trim() && starterWorkspaces[0]) setName(starterWorkspaces[0]);
              setStep(2);
            }}
          />
          <AuthLink
            label="Skip for now"
            onPress={() => {
              setUses([]);
              setStep(2);
            }}
          />
        </View>
        {signedIn}
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      contentKey="workspace"
      block={<NowBlock label="Step 2 of 2 · Your workspace" />}
      title={"Name your\nfirst workspace."}
      lead="A workspace holds your tasks, calendar, docs and sheets. You can rename it or add more later."
    >
      {error ? <AuthNotice>{error}</AuthNotice> : null}
      <AuthField
        label="Workspace name"
        value={name}
        onChangeText={setName}
        placeholder="Work, Studio or Personal"
        autoCapitalize="words"
      />
      {starterWorkspaces.length ? (
        <View style={styles.group} testID="starter-workspaces">
          <SectionLabel>Suggested names</SectionLabel>
          <View style={styles.chips}>
            {starterWorkspaces.map((n) => (
              <ChoiceChip key={n} label={n} pressed={name.trim() === n} onPress={() => setName(n)} />
            ))}
          </View>
          {others.length ? (
            <>
              <SectionLabel>Also create</SectionLabel>
              <View style={styles.chips}>
                {others.map((n) => (
                  <ChoiceChip
                    key={n}
                    label={`${n} workspace`}
                    color={DAY_COLORS.violet}
                    pressed={alsoCreate.has(n)}
                    onPress={() => toggleAlso(n)}
                  />
                ))}
              </View>
            </>
          ) : null}
        </View>
      ) : null}
      <View style={styles.actions}>
        <AuthButton
          label={pending ? "Creating…" : "Create workspace"}
          pending={pending}
          disabled={pending}
          onPress={() => void submit()}
        />
        {chosen.length || extra.length ? (
          <Text style={[styles.hint, { textAlign: "center" }]}>
            {[
              chosen.length ? `Adds ${chosen.length} starter label${chosen.length === 1 ? "" : "s"}` : "",
              extra.length ? `${chosen.length ? "and" : "Adds"} ${extra.length} more workspace${extra.length === 1 ? "" : "s"}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            .
          </Text>
        ) : null}
        <AuthLink label="Back" disabled={pending} onPress={() => setStep(1)} />
      </View>
      {signedIn}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  group: { gap: 10 },
  hint: { color: AUTH.soft, fontSize: 12, lineHeight: 17 },
  actions: { marginTop: 8, gap: 4 },
  signedIn: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: AUTH.lineStrong,
    paddingTop: 6,
  },
  signedInText: { flex: 1, color: AUTH.soft, fontSize: 12 },
});
