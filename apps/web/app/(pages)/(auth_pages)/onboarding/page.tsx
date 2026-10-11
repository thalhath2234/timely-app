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
import { LogoLoader, LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import AuthShell, { NowBlock } from "@/app/_components/auth/authShell";
import DayPanel from "@/app/_components/auth/dayPanel";
import { AuthField, ChoiceChip } from "@/app/_components/auth/fields";
import { onboardingDay } from "@/app/_components/auth/sampleDay";
import { routeAfterOnboarding } from "@/app/utils/desktopInstance";

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

  useEffect(() => {
    if (isOnboardingDone) {
      router.replace("/calendar");
    }
  }, [isOnboardingDone, router]);

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
      if (workspace?.id && chosenLabels.length > 0)
        await applyStarterLabels(workspace.id, chosenLabels).catch(() => {});
      for (const name of extraWorkspaces)
        await createWorkspace({ name }).catch(() => {});

      if (!isOnboardingDone) {
        await completeOnboarding();
      }

      return workspace;
    },

    onSuccess: async () => {
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

      // Inside the desktop app the first-run wizard (Tailscale, agent
      // provider, phone pairing) runs once before the calendar.
      const bridge = window.timelyDesktop?.instance;
      const instance = bridge ? await bridge.get().catch(() => null) : null;
      router.replace(routeAfterOnboarding(instance));
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
      <button
        type="button"
        onClick={() => void signOut()}
        className="s-link underline-offset-4 hover:underline"
      >
        Sign out
      </button>
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
            <button
              type="button"
              disabled={uses.length === 0}
              onClick={() => {
                if (!workspaceName && starterWorkspaces[0])
                  nameWorkspace(starterWorkspaces[0]);
                setStep(2);
              }}
              className="lp-btn lp-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
              <ArrowRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setUses([]);
                setStep(2);
              }}
              className="s-link rounded-lg px-3 py-2 text-sm"
            >
              Skip for now
            </button>
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
            <button
              type="submit"
              disabled={!isValid || isPending}
              className="lp-btn lp-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? (
                <>
                  <LogoSpinner size={18} tone="mono" label="Creating" />
                  Creating…
                </>
              ) : (
                <>
                  Create workspace
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={isPending}
              className="s-link inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm"
            >
              <ArrowLeft className="size-3.5" /> Back
            </button>
          </div>
          {chosenLabels.length > 0 || extraWorkspaces.length > 0 ? (
            <p className="mt-3 text-xs text-[var(--lp-soft)]">
              {[
                chosenLabels.length > 0
                  ? `Adds ${chosenLabels.length} starter label${chosenLabels.length === 1 ? "" : "s"}`
                  : "",
                extraWorkspaces.length > 0
                  ? `${chosenLabels.length > 0 ? "and" : "Adds"} ${extraWorkspaces.length} more workspace${extraWorkspaces.length === 1 ? "" : "s"}`
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
