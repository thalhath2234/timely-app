"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { completeOnboarding, createWorkspace } from "@/app/utils/api/worksapce";
import { Config } from "@/app/_types/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useConfig } from "@/app/utils/hooks/workspaces";
import { apiFetch, setAccessToken } from "@/app/utils/api/client";
import { getMe } from "@/app/utils/api/user";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  applyStarterLabels,
  getPersonalPrefs,
  getStarterPresets,
  savePersonalUseCase,
} from "@/app/utils/api/decisions";
import { AnimatePresence, motion } from "motion/react";
import { LogoLoader } from "@/app/_components/_ui/timelyLogo";
import Button from "@/app/_components/_ui/button";
import AuthShell, { NowBlock } from "@/app/_components/auth/authShell";
import DayPanel from "@/app/_components/auth/dayPanel";
import { AuthField, ChoiceChip } from "@/app/_components/auth/fields";
import { onboardingDay } from "@/app/_components/auth/sampleDay";
import { routeAfterOnboarding } from "@/app/utils/desktopInstance";
import FirstRunTour from "@/app/_components/auth/firstRunTour";
import { splitStarterLabels } from "@timely/contract/starterLabels";

const workspaceSchema = z.object({
  name: z
    .string()
    .min(2, "Workspace name must be at least 2 characters")
    .max(100, "Workspace name must be less than 100 characters"),
});

type WorkspaceForm = z.infer<typeof workspaceSchema>;

export default function Onboarding() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: config, isLoading: isConfigLoading } = useConfig();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe });

  // Step 1 asks what Timely is for and offers starter labels from a fixed
  // catalog (no smart suggestions needed); step 2 names the workspace.
  const [step, setStep] = useState<1 | 2>(1);
  const [uses, setUses] = useState<string[]>([]);
  const [unpicked, setUnpicked] = useState<Set<string>>(new Set());
  // Starter workspaces: each picked use offers a workspace name; the first
  // can name this workspace and the others can be created alongside it.
  const [alsoCreate, setAlsoCreate] = useState<Set<string>>(new Set());
  const { data: personal } = useQuery({
    queryKey: ["personal-prefs"],
    queryFn: getPersonalPrefs,
    retry: false,
  });
  const { data: presets } = useQuery({
    queryKey: ["starter-presets", uses.join(",")],
    queryFn: () => getStarterPresets(uses),
    enabled: uses.length > 0,
    retry: false,
  });
  const useOptions = personal?.uses ?? [];
  const starter = uses.length > 0 ? (presets?.labels ?? []) : [];
  const chosenLabels = starter.filter((l) => !unpicked.has(l.name));
  const starterWorkspaces = [
    ...new Set(
      useOptions
        .filter((u) => uses.includes(u.key) && u.workspace)
        .map((u) => u.workspace as string),
    ),
  ];
  const toggleUse = (key: string) =>
    setUses((prev) =>
      prev.includes(key) ? prev.filter((u) => u !== key) : [...prev, key],
    );
  const toggleLabel = (name: string) =>
    setUnpicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const typedConfig = config as Config | undefined;
  const isOnboardingDone = Boolean(typedConfig?.isOnBoardingCompleted);
  // After the workspace is made, the first-run tour plays once; "Open
  // Timely" (or Escape) then goes where onboarding would have gone.
  const [tour, setTour] = useState<null | "/setup" | "/calendar">(null);

  useEffect(() => {
    if (isOnboardingDone && !tour) {
      router.replace("/calendar");
    }
  }, [isOnboardingDone, router, tour]);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isValid },
  } = useForm<WorkspaceForm>({
    resolver: zodResolver(workspaceSchema),
    mode: "onChange",
  });
  const workspaceName = (useWatch({ control, name: "name" }) ?? "").trim();
  const extraWorkspaces = starterWorkspaces.filter(
    (n) => alsoCreate.has(n) && n.toLowerCase() !== workspaceName.toLowerCase(),
  );
  const split = splitStarterLabels(chosenLabels, uses, useOptions, extraWorkspaces);
  const extrasHaveLabels = Object.values(split.extras).some((l) => l.length > 0);
  const nameWorkspace = (name: string) =>
    setValue("name", name, { shouldValidate: true, shouldDirty: true });
  const toggleAlso = (name: string) =>
    setAlsoCreate((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: { name: string }) => {
      const workspace = await createWorkspace(data);
      // Starter labels and the use case are extras: a failure here never
      // blocks finishing onboarding.
      const useCase = useOptions
        .filter((u) => uses.includes(u.key))
        .map((u) => u.label)
        .join(", ");
      if (useCase) await savePersonalUseCase(useCase).catch(() => {});
      if (workspace?.id && split.first.length > 0)
        await applyStarterLabels(workspace.id, split.first).catch(() => {});
      for (const name of extraWorkspaces) {
        const extra = await createWorkspace({ name }).catch(() => null);
        const own = split.extras[name] ?? [];
        if (extra?.id && own.length > 0)
          await applyStarterLabels(extra.id, own).catch(() => {});
      }

      if (!isOnboardingDone) {
        await completeOnboarding();
      }

      return workspace;
    },

    onSuccess: async () => {
      // Inside the desktop app the first-run wizard (Tailscale, agent
      // provider, phone pairing) runs once before the calendar. The tour
      // is decided before the config refetch, so the redirect above waits.
      const bridge = window.timelyDesktop?.instance;
      const instance = bridge ? await bridge.get().catch(() => null) : null;
      setTour(routeAfterOnboarding(instance));

      await queryClient.invalidateQueries({
        queryKey: ["workspaces"],
      });

      await queryClient.invalidateQueries({
        queryKey: ["config"],
      });

      await apiFetch("/auth/refresh", { method: "POST" });

      await queryClient.setQueryData(["config"], (old: Config | undefined) =>
        old
          ? {
              ...old,
              isOnBoardingCompleted: true,
            }
          : old,
      );

    },
  });

  const onSubmit = (data: WorkspaceForm) => {
    mutate(data);
  };

  const signOut = async () => {
    await apiFetch("/logout", { method: "POST" });
    setAccessToken(null);
    queryClient.clear();
    router.replace("/login");
  };

  if (tour) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <FirstRunTour onDone={() => router.replace(tour)} />
      </div>
    );
  }

  if (isConfigLoading || isOnboardingDone) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LogoLoader
          label="Preparing Timely"
          className="min-h-0 text-[var(--lp-ink)]"
        />
      </div>
    );
  }

  const tabs =
    step === 1
      ? starterWorkspaces
      : [workspaceName || "Your workspace", ...extraWorkspaces];
  const day = onboardingDay(chosenLabels);
  const preview = (compact: boolean) => (
    <DayPanel
      compact={compact}
      title="Your first day"
      hoursBefore={1}
      tabs={tabs}
      blocks={day}
      empty="Pick what Timely is for and your day fills in here."
      className={compact ? "mt-8 lg:hidden" : undefined}
    />
  );

  const signedIn = me?.email ? (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--lp-line)] pt-4 text-xs text-[var(--lp-soft)]">
      <span>
        Signed in as <span className="text-[var(--lp-ink)]">{me.email}</span>
      </span>
      <Button variant="link" size="sm" onClick={() => void signOut()}>
        Sign out
      </Button>
    </div>
  ) : null;

  const sectionLabel = "mb-2.5 text-[13px] font-medium text-[var(--lp-soft)]";

  return (
    <AuthShell
      contentKey={`step-${step}`}
      block={
        <NowBlock
          label={
            step === 1
              ? "Step 1 of 2 · What it’s for"
              : "Step 2 of 2 · Your workspace"
          }
        />
      }
      title={
        step === 1 ? "What fills your days?" : "Name your first workspace."
      }
      lead={
        step === 1
          ? "Pick any that fit. Timely adds a few labels to match, and you can watch them land on your day."
          : "A workspace holds your tasks, calendar, docs and sheets. You can rename it or add more later in Settings."
      }
      aside={preview(false)}
    >
      {step === 1 ? (
        <div data-testid="onboarding-uses">
          <div className="flex flex-wrap gap-2">
            {useOptions.map((u) => (
              <ChoiceChip
                key={u.key}
                pressed={uses.includes(u.key)}
                onClick={() => toggleUse(u.key)}
              >
                {u.label}
              </ChoiceChip>
            ))}
          </div>

          <AnimatePresence initial={false}>
            {starter.length > 0 ? (
              <motion.div
                key="labels"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <p className={`${sectionLabel} mt-8`}>Starter labels</p>
                <div className="flex flex-wrap gap-2">
                  {starter.map((l) => {
                    const on = !unpicked.has(l.name);
                    return (
                      <ChoiceChip
                        key={l.name}
                        pressed={on}
                        off={!on}
                        color={l.color}
                        onClick={() => toggleLabel(l.name)}
                      >
                        {l.name}
                      </ChoiceChip>
                    );
                  })}
                </div>
                <p className="mt-2.5 text-xs text-[var(--lp-soft)]">
                  Tap a label to leave it out. You can edit labels later in
                  Settings.
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {chosenLabels.length > 0 ? preview(true) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              disabled={uses.length === 0}
              onClick={() => {
                if (!workspaceName && starterWorkspaces[0])
                  nameWorkspace(starterWorkspaces[0]);
                setStep(2);
              }}
              trailing={<ArrowRight />}
            >
              Continue
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                setUses([]);
                setStep(2);
              }}
            >
              Skip for now
            </Button>
          </div>
          {signedIn}
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <AuthField
            id="workspace-name"
            label="Workspace name"
            type="text"
            placeholder="Work, Studio or Personal"
            autoComplete="off"
            autoFocus
            error={errors.name?.message}
            {...register("name")}
          />

          {starterWorkspaces.length > 0 ? (
            <div data-testid="starter-workspaces">
              <p className={`${sectionLabel} mt-7`}>Suggested names</p>
              <div className="flex flex-wrap gap-2">
                {starterWorkspaces.map((n) => (
                  <ChoiceChip
                    key={n}
                    pressed={workspaceName === n}
                    onClick={() => nameWorkspace(n)}
                  >
                    {n}
                  </ChoiceChip>
                ))}
              </div>
              {starterWorkspaces.some(
                (n) => n.toLowerCase() !== workspaceName.toLowerCase(),
              ) ? (
                <>
                  <p className={`${sectionLabel} mt-7`}>Also create</p>
                  <div className="flex flex-wrap gap-2">
                    {starterWorkspaces
                      .filter(
                        (n) => n.toLowerCase() !== workspaceName.toLowerCase(),
                      )
                      .map((n) => (
                        <ChoiceChip
                          key={n}
                          pressed={alsoCreate.has(n)}
                          color="var(--lp-violet)"
                          onClick={() => toggleAlso(n)}
                        >
                          {n} workspace
                        </ChoiceChip>
                      ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              size="lg"
              disabled={!isValid}
              loading={isPending}
              trailing={isPending ? null : <ArrowRight />}
            >
              {isPending ? "Creating…" : "Create workspace"}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setStep(1)}
              disabled={isPending}
              leading={<ArrowLeft />}
            >
              Back
            </Button>
          </div>
          {chosenLabels.length > 0 || extraWorkspaces.length > 0 ? (
            <p className="mt-3 text-xs text-[var(--lp-soft)]">
              {[
                chosenLabels.length > 0
                  ? `Adds ${chosenLabels.length} starter label${chosenLabels.length === 1 ? "" : "s"}`
                  : "",
                extraWorkspaces.length > 0
                  ? `${chosenLabels.length > 0 ? "and" : "Adds"} ${extraWorkspaces.length} more workspace${extraWorkspaces.length === 1 ? "" : "s"}${extrasHaveLabels ? ", each with its own labels" : ""}`
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              .
            </p>
          ) : null}
          {signedIn}
        </form>
      )}
    </AuthShell>
  );
}
