"use client";
import { useMemo, useState } from "react";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import * as motion from "motion/react-client";
import { AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useProjects } from "@/app/utils/hooks/projects";
import { createProject } from "@/app/utils/api/projects";
import { Project, Workspace } from "@/app/_types/types";

const addWorkspaceSchema = z.object({
  name: z
    .string()
    .min(2, "Workspace name must be at least 2 characters")
    .max(100, "Workspace name must be less than 100 characters"),
});

type AddWorkspaceForm = z.infer<typeof addWorkspaceSchema>;

const addProjectSchema = z.object({
  title: z
    .string()
    .min(2, "Project name must be at least 2 characters")
    .max(100, "Project name must be less than 100 characters"),
  workspaceId: z.string().min(1, "Please select a workspace"),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional(),
  statusId: z
    .string()
    .regex(
      /^tst_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      "Status ID must be a valid tst UUID",
    ),
  priorityLevel: z.string(),
  startDate: z.date(),
  deadline: z.date(),
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{6})$/, "Color must be a valid hex value"),
});

type AddProjectForm = z.infer<typeof addProjectSchema>;

export default function AddItemModal() {
  const { isAddItemModalOpen, setIsAddItemModalOpen, addNewMode } =
    useSidebarStore();

  const queryClient = useQueryClient();
  const { data: workspaces } = useWorkspaces();
  const { data: projects } = useProjects();
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  const typedWorkspaces = useMemo(
    () => (workspaces ?? []) as Workspace[],
    [workspaces],
  );
  const typedProjects = useMemo(
    () => (projects ?? []) as Project[],
    [projects],
  );
  const selectedProjects = useMemo(
    () =>
      typedProjects.filter((project) =>
        selectedProjectIds.includes(project.id),
      ),
    [typedProjects, selectedProjectIds],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<AddWorkspaceForm>({
    resolver: zodResolver(addWorkspaceSchema),
    mode: "onChange",
  });

  const {
    register: registerProject,
    handleSubmit: handleProjectSubmit,
    reset: resetProject,
    formState: { errors: projectErrors, isValid: isProjectValid },
  } = useForm<AddProjectForm>({
    resolver: zodResolver(addProjectSchema),
    mode: "onChange",
    defaultValues: {
      color: "#30A66D",
    },
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: async (data: AddWorkspaceForm) => {
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

  const onSubmit = (data: AddWorkspaceForm) => {
    createWorkspaceMutation.mutate(data);
  };

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async (project: Project) => {
      await queryClient.invalidateQueries({
        queryKey: ["projects"],
      });

      resetProject();
      setSelectedProjectIds((previous) =>
        previous.includes(project.id) ? previous : [...previous, project.id],
      );
    },
  });

  const onProjectSubmit = (data: AddProjectForm) => {
    createProjectMutation.mutate(data);
  };

  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjectIds((previous) =>
      previous.includes(projectId)
        ? previous.filter((id) => id !== projectId)
        : [...previous, projectId],
    );
  };

  const closeModal = () => {
    reset();
    resetProject();
    setIsAddItemModalOpen(false);
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
          onClick={closeModal}
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
                      closeModal();
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

            {addNewMode === "project" && (
              <div className="flex flex-col h-full">
                <h2 className="w-full px-4 py-3 text-white/70 border-b border-white/10">
                  Add Project
                </h2>

                <div className="grid grid-cols-2 gap-0 h-full min-h-105">
                  <form
                    onSubmit={handleProjectSubmit(onProjectSubmit)}
                    className="border-r border-white/10 p-3 flex flex-col gap-3"
                  >
                    <input
                      autoFocus
                      {...registerProject("title")}
                      placeholder="Project name"
                      className="w-full px-3 py-2 bg-transparent text-white placeholder-white/40 outline-none border border-white/10 rounded-md"
                    />

                    {projectErrors.title && (
                      <p className="text-xs text-red-400">
                        {projectErrors.title.message}
                      </p>
                    )}

                    <select
                      {...registerProject("workspaceId")}
                      className="w-full px-3 py-2 bg-transparent text-white outline-none border border-white/10 rounded-md"
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Select workspace
                      </option>
                      {typedWorkspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>

                    {projectErrors.workspaceId && (
                      <p className="text-xs text-red-400">
                        {projectErrors.workspaceId.message}
                      </p>
                    )}

                    <textarea
                      {...registerProject("description")}
                      placeholder="Description (optional)"
                      className="w-full h-28 px-3 py-2 bg-transparent text-white placeholder-white/40 outline-none border border-white/10 rounded-md resize-none"
                    />

                    <div className="flex items-center gap-2">
                      <label className="text-xs text-white/70">Color</label>
                      <input
                        type="color"
                        {...registerProject("color")}
                        className="h-8 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
                      />
                    </div>

                    {projectErrors.color && (
                      <p className="text-xs text-red-400">
                        {projectErrors.color.message}
                      </p>
                    )}

                    <div className="mt-auto flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="px-4 py-2 rounded-md bg-zinc-700/60 hover:bg-zinc-600/70 text-white font-medium transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>

                      <button
                        type="submit"
                        disabled={
                          !isProjectValid || createProjectMutation.isPending
                        }
                        className="px-4 py-2 rounded-md bg-blue-900 hover:bg-blue-800 text-white font-medium transition-colors cursor-pointer disabled:bg-blue-900/50 disabled:text-zinc-400 disabled:cursor-not-allowed"
                      >
                        {createProjectMutation.isPending
                          ? "Saving..."
                          : "Save Project"}
                      </button>
                    </div>
                  </form>

                  <div className="p-3 flex flex-col gap-3">
                    <p className="text-sm text-white/80 font-medium">
                      Select Projects
                    </p>

                    <div className="flex-1 overflow-auto border border-white/10 rounded-md p-2 space-y-1">
                      {typedProjects.map((project) => {
                        const checked = selectedProjectIds.includes(project.id);
                        return (
                          <label
                            key={project.id}
                            className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer"
                          >
                            <span className="text-sm text-white/85 truncate">
                              {project.name ||
                                project.title ||
                                "Untitled project"}
                            </span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleProjectSelection(project.id)
                              }
                            />
                          </label>
                        );
                      })}

                      {typedProjects.length === 0 && (
                        <p className="text-xs text-white/50 px-2 py-2">
                          No projects found.
                        </p>
                      )}
                    </div>

                    <div className="border border-white/10 rounded-md p-2">
                      <p className="text-xs text-white/60 mb-1">
                        Selected ({selectedProjects.length})
                      </p>
                      <div className="max-h-28 overflow-auto space-y-1">
                        {selectedProjects.map((project) => (
                          <p
                            key={project.id}
                            className="text-xs text-white/85 truncate"
                          >
                            {project.name ||
                              project.title ||
                              "Untitled project"}
                          </p>
                        ))}
                        {selectedProjects.length === 0 && (
                          <p className="text-xs text-white/40">
                            No selected projects yet.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
