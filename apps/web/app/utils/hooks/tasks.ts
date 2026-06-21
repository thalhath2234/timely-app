// features/tasks/hooks.ts

import { useQuery } from "@tanstack/react-query";
import { getTasks } from "@/app/utils/api/tasks";

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: getTasks,
  });
}