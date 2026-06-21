// features/tasks/hooks.ts

import { useQuery } from "@tanstack/react-query";
import { getWorkspaces, getConfig } from "@/app/utils/api/worksapce";

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: getWorkspaces,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    staleTime: 1000 * 60 * 5,
  });
}
