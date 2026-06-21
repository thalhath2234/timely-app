// features/tasks/hooks.ts

import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/app/utils/api/user";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: getMe,
  });
}