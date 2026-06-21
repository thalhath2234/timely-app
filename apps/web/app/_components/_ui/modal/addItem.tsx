"use client";
import { useEffect } from "react";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import * as motion from "motion/react-client";
import { AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const addItemSchema = z.object({
  name: z
    .string()
    .min(2, "Workspace name must be at least 2 characters")
    .max(100, "Workspace name must be less than 100 characters"),
});

type AddItemForm = z.infer<typeof addItemSchema>;

export default function AddItemModal() {
  const { isAddItemModalOpen, setIsAddItemModalOpen, addNewMode } =
    useSidebarStore();

  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<AddItemForm>({
    resolver: zodResolver(addItemSchema),
    mode: "onChange",
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: async (data: AddItemForm) => {
      const response = await fetch("http://localhost:8080/workspaces", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: data.name,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create workspace");
      }

      return response.json();
    },

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces"],
      });

      reset();
      setIsAddItemModalOpen(false);
    },
  });

  const onSubmit = (data: AddItemForm) => {
    createWorkspaceMutation.mutate(data);
  };

  return (
    <AnimatePresence>
      {isAddItemModalOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          //   exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.01, ease: "easeOut" }}
          onClick={() => setIsAddItemModalOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className="w-150 max-w-[90vw] max-h-[60vh] rounded-lg border border-white/40 shadow-2xl overflow-hidden flex flex-col backdrop-blur-md "
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            {addNewMode === "workspace" && (
              <form
                onSubmit={handleSubmit(onSubmit)}
                className="flex flex-col h-full"
              >
                <h2 className="w-full px-4 py-3 text-white/70 border-b border-white/10">
                  Add Workspace
                </h2>

                <div className="flex-1 overflow-y-auto p-2">
                  <input
                    autoFocus
                    {...register("name")}
                    placeholder="Workspace name"
                    className="w-full px-4 py-3 bg-transparent text-white placeholder-white/40 outline-none border-b border-white/10"
                  />

                  {errors.name && (
                    <p className="mt-2 px-4 text-sm text-red-400">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                <div className="flex justify-end gap-2 mb-2 px-2">
                  <button
                    type="button"
                    onClick={() => {
                      reset();
                      setIsAddItemModalOpen(false);
                    }}
                    className="px-4 py-2 rounded-md bg-zinc-700/60 hover:bg-zinc-600/70 text-white font-medium transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={!isValid || createWorkspaceMutation.isPending}
                    className="px-4 py-2 rounded-md bg-blue-900 hover:bg-blue-800 text-white font-medium transition-colors cursor-pointer disabled:bg-blue-900/50 disabled:text-zinc-400 disabled:cursor-not-allowed"
                  >
                    {createWorkspaceMutation.isPending ? "Saving..." : "Save"}
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
