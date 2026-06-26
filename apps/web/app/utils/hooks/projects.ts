import { useQuery } from "@tanstack/react-query";
import { getProjects } from "@/app/utils/api/projects";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
}
