"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { completeOnboarding, createWorkspace } from "@/app/utils/api/worksapce";
import { Config } from "@/app/_types/types";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useConfig } from "@/app/utils/hooks/workspaces";

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

  const typedConfig = config as Config | undefined;
  const isOnboardingDone = Boolean(
    typedConfig?.isOnBoardingCompleted,
  );

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

  if (isConfigLoading || isOnboardingDone) {
    return null;
  }

  return (
    <div>
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm z-50">
        <h1 className="text-2xl font-semibold tracking-tight text-balance mb-4">
          Create Your First Workspace
        </h1>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-4 flex flex-row gap-2"
        >
          <input
            type="text"
            placeholder="Workspace Name"
            className="px-4 py-2 rounded-lg bg-input/30 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition"
            {...register("name")}
          />

          {errors.name && (
            <p className="text-sm text-destructive">{errors.name.message}</p>
          )}

          <button
            type="submit"
            disabled={!isValid || isPending}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Creating..." : "Create"}
          </button>
        </form>
      </div>
    </div>
  );
}
