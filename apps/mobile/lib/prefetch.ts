import type { QueryClient } from "@tanstack/react-query";
import { getDocs } from "./api/docs";
import { getProjects } from "./api/projects";
import { getSheets } from "./api/sheets";
import { getToday } from "./api/schedule";
import { getTasks } from "./api/tasks";
import { getConfig, getWorkspaces } from "./api/workspaces";

/**
 * Warms the data used by the initial Today screen before navigation settles.
 * Adjacent tab data starts at the same time, but never extends startup time.
 */
export async function prefetchStartupData(client: QueryClient) {
  const initialScreen = Promise.all([
    client.prefetchQuery({ queryKey: ["today"], queryFn: () => getToday() }),
    client.prefetchQuery({ queryKey: ["tasks"], queryFn: () => getTasks() }),
    client.prefetchQuery({ queryKey: ["config"], queryFn: getConfig }),
  ]);

  void Promise.all([
    client.prefetchQuery({ queryKey: ["workspaces"], queryFn: getWorkspaces }),
    client.prefetchQuery({ queryKey: ["projects"], queryFn: getProjects }),
    client.prefetchQuery({ queryKey: ["docs"], queryFn: getDocs }),
    client.prefetchQuery({ queryKey: ["sheets"], queryFn: getSheets }),
  ]);

  await initialScreen;
}
