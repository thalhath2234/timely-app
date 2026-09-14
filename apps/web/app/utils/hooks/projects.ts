import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  UpdateProjectPayload,
  createStage,
  deleteProject,
  deleteStage,
  duplicateProject,
  getProject,
  getProjectActivity,
  getProjects,
  reorderStages,
  updateProject,
  updateStage,
} from "@/app/utils/api/projects";
import { Project } from "@/app/_types/types";

export const projectsKey = ["projects"] as const;
export const projectKey = (id: string) => ["projects", id] as const;

function syncProjectCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  project: Project,
) {
  queryClient.setQueryData(projectKey(project.id), project);
  queryClient.setQueryData<Project[]>(projectsKey, (projects) => {
    if (!projects) return [project];
    if (projects.some((item) => item.id === project.id)) {
      return projects.map((item) => (item.id === project.id ? { ...item, ...project } : item));
    }
    return [project, ...projects];
  });
}

export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: getProjects,
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: projectKey(id ?? ""),
    queryFn: () => getProject(id!),
    enabled: Boolean(id),
  });
}

export const projectActivityKey = (id: string) => ["projects", id, "activity"] as const;

export function useProjectActivity(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: projectActivityKey(id ?? ""),
    queryFn: () => getProjectActivity(id!),
    enabled: enabled && Boolean(id),
    staleTime: 15_000,
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateProjectPayload & { id: string }) =>
      updateProject(id, payload),
    onSuccess: (project) => {
      syncProjectCaches(queryClient, project);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: projectKey(id) });
      queryClient.setQueryData<Project[]>(projectsKey, (projects) =>
        projects?.filter((item) => item.id !== id),
      );
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

function invalidateProject(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: projectsKey }),
    queryClient.invalidateQueries({ queryKey: projectKey(projectId) }),
    queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  ]);
}

export function useCreateStage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; color?: string } | string) =>
      createStage(projectId, typeof data === "string" ? { name: data } : data),
    onSuccess: () => invalidateProject(queryClient, projectId),
  });
}

export function useUpdateStage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      stageId,
      name,
      color,
    }: {
      stageId: string;
      name?: string;
      color?: string;
    }) => updateStage(projectId, stageId, { name, color }),
    onSuccess: () => invalidateProject(queryClient, projectId),
  });
}

export function useDeleteStage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stageId: string) => deleteStage(projectId, stageId),
    onSuccess: () => invalidateProject(queryClient, projectId),
  });
}

export function useReorderStages(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => reorderStages(projectId, ids),
    onSuccess: () => invalidateProject(queryClient, projectId),
  });
}

export function useDuplicateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: duplicateProject,
    onSuccess: (project) => {
      syncProjectCaches(queryClient, project);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
