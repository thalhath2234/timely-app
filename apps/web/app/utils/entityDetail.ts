import { useEntityDetailStore } from "@/app/_store/entityDetailStore";

export type TasksEntityRef = {
  kind: "task" | "project";
  id: string;
};

export function isTasksListPath(pathname: string) {
  return pathname === "/tasks";
}

/** Pull a task or project id out of `/tasks?taskId=` / `/tasks?projectId=`. */
export function parseTasksEntityHref(
  href: string,
  origin?: string,
): TasksEntityRef | null {
  if (!href || href === "#") return null;

  const base =
    origin ||
    (typeof window !== "undefined" ? window.location.origin : "http://local.invalid");

  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }

  if (url.pathname !== "/tasks") return null;

  const taskId = url.searchParams.get("taskId");
  if (taskId) return { kind: "task", id: taskId };

  const projectId = url.searchParams.get("projectId");
  if (projectId) return { kind: "project", id: projectId };

  return null;
}

/**
 * Open a task or project on the current page. On `/tasks` the list still
 * owns the detail via the query string so deep links and row selection match.
 */
export function openTasksEntity(
  entity: TasksEntityRef,
  options?: { navigate?: (href: string) => void },
) {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  if (isTasksListPath(pathname)) {
    const param = entity.kind === "task" ? "taskId" : "projectId";
    options?.navigate?.(`/tasks?${param}=${encodeURIComponent(entity.id)}`);
    return;
  }

  useEntityDetailStore.getState().openEntity(entity.kind, entity.id);
}

/** @returns true when `href` pointed at a task or project detail. */
export function openTasksEntityHref(
  href: string,
  navigate?: (href: string) => void,
): boolean {
  const entity = parseTasksEntityHref(href);
  if (!entity) return false;
  openTasksEntity(entity, navigate ? { navigate } : undefined);
  return true;
}
