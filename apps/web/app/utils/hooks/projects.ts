import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UpdateProjectPayload, getProjects, updateProject } from "@/app/utils/api/projects";
import { Project } from "@/app/_types/types";

export const projectsKey = ["projects"] as const;

export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: getProjects,
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateProjectPayload & { id: string }) =>
      updateProject(id, payload),
    // Autosave fires often, so the cache is patched in place rather than
    // refetching every project on each keystroke batch.
    onSuccess: (project) => {
      queryClient.setQueryData<Project[]>(projectsKey, (projects) =>
        projects?.map((item) => (item.id === project.id ? project : item)),
      );
      // Tasks embed their project, so their copy is now stale.
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
