"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { completeOnboarding, createWorkspace } from "@/app/utils/api/worksapce";
import { Config } from "@/app/_types/types";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

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

      await completeOnboarding();

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
              isOnboardingCompleted: true,
            }
          : old,
      );

      router.replace("/calendar");
    },
  });

  const onSubmit = (data: WorkspaceForm) => {
    mutate(data);
  };

  return (
    <div>
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-background bg-opacity-50 z-50">
        <h1 className="text-2xl font-bold mb-4">Create Your First Workspace</h1>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-4 flex flex-row gap-2"
        >
          <input
            type="text"
            placeholder="Workspace Name"
            className="px-4 py-2 rounded-md bg-secondary text-white focus:outline-none focus:ring-2 focus:ring-tertiary"
            {...register("name")}
          />

          {errors.name && (
            <p className="text-sm text-red-500">{errors.name.message}</p>
          )}

          <button
            type="submit"
            disabled={!isValid || isPending}
            className="px-4 py-2 rounded-md bg-tertiary text-white font-medium hover:bg-tertiary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Creating..." : "Create"}
          </button>
        </form>
      </div>
    </div>
  );
}
