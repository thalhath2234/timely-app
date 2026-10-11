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
import { ArrowLeft, ArrowRight, Check, Layers } from "lucide-react";
import {
  applyStarterLabels,
  getPersonalPrefs,
  getStarterPresets,
  savePersonalUseCase,
} from "@/app/utils/api/decisions";
import AuthBrandPanel from "../_components/authBrandPanel";
import { motion } from "motion/react";
import {
  LogoLoader,
  LogoSpinner,
  TimelyWordmark,
} from "@/app/_components/_ui/timelyLogo";
import { springSoft } from "@/app/_components/_ui/motion";
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
    (n) =>
      alsoCreate.has(n) && n.toLowerCase() !== workspaceName.toLowerCase(),
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
      <div className="flex min-h-screen items-center justify-center bg-[#0c0e14]">
        <LogoLoader
          label="Preparing Timely"
          className="min-h-0 text-[#e2e2eb]"
        />
      </div>
    );
  }

  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col bg-[#0c0e14] text-[#e2e2eb] md:flex-row"
    >
      <AuthBrandPanel />

      <section className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-12 sm:px-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#282a30_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSoft}
          className="relative z-10 w-full max-w-[420px] rounded-xl border border-white/10 bg-[#191b22] p-8 shadow-2xl sm:p-9"
        >
          <div className="mb-6 flex items-center justify-center gap-2.5 md:hidden">
            <TimelyWordmark />
          </div>

          <span className="inline-flex rounded-full border border-[#c0c1ff]/20 bg-[#c0c1ff]/10 px-2.5 py-1 text-[0.6875rem] font-medium tracking-[0.08em] text-[#c0c1ff] uppercase">
            Step {step} of 2
          </span>
          {step === 1 ? (
            <div data-testid="onboarding-uses">
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">
                What will you use Timely for?
              </h1>
              <p className="mt-1.5 text-sm text-[#908fa0]">
                Pick any that fit. Timely sets up a few labels to match.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {useOptions.map((u) => {
                  const on = uses.includes(u.key);
                  return (
                    <button
                      key={u.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleUse(u.key)}
                      className={
                        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition " +
                        (on
                          ? "border-[#c0c1ff] bg-[#c0c1ff]/15 text-[#e2e2eb]"
                          : "border-white/10 text-[#c7c4d7] hover:border-white/25")
                      }
                    >
                      {on ? (
                        <Check className="size-3.5 text-[#c0c1ff]" />
                      ) : null}
                      {u.label}
                    </button>
                  );
                })}
              </div>
              {starter.length > 0 ? (
                <div className="mt-6">
                  <p className="mb-2 text-[0.6875rem] font-medium tracking-[0.08em] text-[#c7c4d7] uppercase">
                    Starter labels
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {starter.map((l) => {
                      const on = !unpicked.has(l.name);
                      return (
                        <button
                          key={l.name}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleLabel(l.name)}
                          className={
                            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition " +
                            (on
                              ? "border-white/15 bg-[#0c0e14] text-[#e2e2eb]"
                              : "border-dashed border-white/10 text-[#908fa0] opacity-60")
                          }
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: l.color }}
                          />
                          {l.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-[#908fa0]">
                    Tap a label to leave it out. You can edit labels later in
                    settings.
                  </p>
                </div>
              ) : null}
              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setUses([]);
                    setStep(2);
                  }}
                  className="h-11 flex-1 rounded-lg border border-white/10 text-sm font-medium text-[#c7c4d7] transition hover:border-white/25"
                >
                  Skip
                </button>
                <button
                  type="button"
                  disabled={uses.length === 0}
                  onClick={() => {
                    if (!workspaceName && starterWorkspaces[0])
                      nameWorkspace(starterWorkspaces[0]);
                    setStep(2);
                  }}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#c0c1ff] text-sm font-semibold text-[#1000a9] shadow-sm transition hover:bg-[#a8a6ff] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue
                  <ArrowRight className="size-4" />
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">
                Create Your First Workspace
              </h1>
              <p className="mt-1.5 text-sm text-[#908fa0]">
                Name the space where tasks, calendar, and docs will live.
              </p>

              <form
                onSubmit={handleSubmit(onSubmit)}
                className="mt-6 space-y-4"
              >
                <div>
                  <label
                    htmlFor="workspace-name"
                    className="mb-2 block text-[0.6875rem] font-medium tracking-[0.08em] text-[#c7c4d7] uppercase"
                  >
                    Workspace Name
                  </label>
                  <div className="flex h-11 w-full items-center rounded-lg border border-white/10 bg-[#0c0e14] transition focus-within:border-[#c0c1ff] focus-within:ring-1 focus-within:ring-[#c0c1ff]">
                    <Layers className="ml-3.5 mr-2.5 size-[18px] shrink-0 text-[#908fa0]" />
                    <input
                      id="workspace-name"
                      type="text"
                      placeholder="Acme Corp, My Team, or Personal"
                      className="h-full w-full bg-transparent pr-3.5 text-sm text-[#e2e2eb] outline-none placeholder:text-[#908fa0]/70"
                      {...register("name")}
                    />
                  </div>
                  {errors.name ? (
                    <p className="mt-2 text-xs text-[#ffb4ab]">
                      {errors.name.message}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-[#908fa0]">
                      You can change your workspace name or create additional
                      workspaces later in settings.
                    </p>
                  )}
                </div>

                {starterWorkspaces.length > 0 ? (
                  <div data-testid="starter-workspaces">
                    <p className="mb-2 text-[0.6875rem] font-medium tracking-[0.08em] text-[#c7c4d7] uppercase">
                      Suggested names
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {starterWorkspaces.map((n) => (
                        <button
                          key={n}
                          type="button"
                          aria-pressed={workspaceName === n}
                          onClick={() => nameWorkspace(n)}
                          className={
                            "rounded-full border px-2.5 py-1 text-xs transition " +
                            (workspaceName === n
                              ? "border-[#c0c1ff] bg-[#c0c1ff]/15 text-[#e2e2eb]"
                              : "border-white/10 text-[#c7c4d7] hover:border-white/25")
                          }
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    {starterWorkspaces.some(
                      (n) => n.toLowerCase() !== workspaceName.toLowerCase(),
                    ) ? (
                      <>
                        <p className="mt-4 mb-2 text-[0.6875rem] font-medium tracking-[0.08em] text-[#c7c4d7] uppercase">
                          Also create
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {starterWorkspaces
                            .filter(
                              (n) =>
                                n.toLowerCase() !== workspaceName.toLowerCase(),
                            )
                            .map((n) => {
                              const on = alsoCreate.has(n);
                              return (
                                <button
                                  key={n}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => toggleAlso(n)}
                                  className={
                                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition " +
                                    (on
                                      ? "border-[#c0c1ff] bg-[#c0c1ff]/15 text-[#e2e2eb]"
                                      : "border-dashed border-white/10 text-[#908fa0] hover:border-white/25")
                                  }
                                >
                                  {on ? (
                                    <Check className="size-3 text-[#c0c1ff]" />
                                  ) : null}
                                  {n} workspace
                                </button>
                              );
                            })}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={!isValid || isPending}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#c0c1ff] text-sm font-semibold text-[#1000a9] shadow-sm transition hover:bg-[#a8a6ff] focus:outline-none focus:ring-2 focus:ring-[#c0c1ff]/50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPending ? (
                    <>
                      <LogoSpinner size={20} tone="mono" label="Creating" />
                      Creating...
                    </>
                  ) : (
                    <>
                      Create Workspace
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </button>
                {chosenLabels.length > 0 || extraWorkspaces.length > 0 ? (
                  <p className="text-center text-xs text-[#908fa0]">
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
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={isPending}
                  className="mx-auto flex items-center gap-1 text-xs text-[#908fa0] hover:text-[#c7c4d7]"
                >
                  <ArrowLeft className="size-3" /> Back
                </button>
              </form>
            </>
          )}

          {me?.email ? (
            <div className="mt-6 flex items-center justify-between text-xs text-[#908fa0]">
              <span>
                Signed in as <span className="text-[#c7c4d7]">{me.email}</span>
              </span>
              <button
                type="button"
                onClick={() => void signOut()}
                className="text-[#c0c1ff] hover:underline"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </motion.div>

        <footer className="relative z-10 mt-8 text-center text-xs text-[#464554]">
          © {new Date().getFullYear()} Timely Technologies Inc. All rights
          reserved.
        </footer>
      </section>
    </main>
  );
}
