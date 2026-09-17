"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { completeOnboarding, createWorkspace } from "@/app/utils/api/worksapce";
import { Config } from "@/app/_types/types";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useConfig } from "@/app/utils/hooks/workspaces";
import { apiFetch, setAccessToken } from "@/app/utils/api/client";
import { getMe } from "@/app/utils/api/user";
import { ArrowRight, Layers, Loader2 } from "lucide-react";
import AuthBrandPanel from "../_components/authBrandPanel";
import { motion } from "motion/react";
import { springSoft } from "@/app/_components/_ui/motion";

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
    formState: { errors, isValid },
  } = useForm<WorkspaceForm>({
    resolver: zodResolver(workspaceSchema),
    mode: "onChange",
  });

  const { mutate, isPending } = useMutation({
    mutationFn: async (data: { name: string }) => {
      const workspace = await createWorkspace(data);

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

      router.replace("/calendar");
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
    return <div className="min-h-screen bg-[#0c0e14]" />;
  }

  return (
    <main id="main-content" className="flex min-h-screen flex-col bg-[#0c0e14] text-[#e2e2eb] md:flex-row">
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
            <div className="flex size-8 items-center justify-center rounded-lg bg-[#c0c1ff] text-[#1000a9]">
              <span className="text-sm font-bold select-none">T</span>
            </div>
            <span className="text-xl font-semibold tracking-tight">Timely</span>
          </div>

          <span className="inline-flex rounded-full border border-[#c0c1ff]/20 bg-[#c0c1ff]/10 px-2.5 py-1 text-[0.6875rem] font-medium tracking-[0.08em] text-[#c0c1ff] uppercase">
            Step 1 of 1
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Create Your First Workspace
          </h1>
          <p className="mt-1.5 text-sm text-[#908fa0]">
            Name the space where tasks, calendar, and docs will live.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
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
                <p className="mt-2 text-xs text-[#ffb4ab]">{errors.name.message}</p>
              ) : (
                <p className="mt-2 text-xs text-[#908fa0]">
                  You can change your workspace name or create additional workspaces later in settings.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={!isValid || isPending}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#c0c1ff] text-sm font-semibold text-[#1000a9] shadow-sm transition hover:bg-[#a8a6ff] focus:outline-none focus:ring-2 focus:ring-[#c0c1ff]/50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Create Workspace
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

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
          © {new Date().getFullYear()} Timely Technologies Inc. All rights reserved.
        </footer>
      </section>
    </main>
  );
}
