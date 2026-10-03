import { TaskExecution, sampleApi } from "@timely/ui";

// Reads the same sample workspace TimelyProvider serves, so rows passed as
// props match what the mocked API returns to the component's own queries.
let api: any = null;
function get<T = any>(route: string, params: Record<string, string> = {}, query = ""): T {
  api ??= sampleApi();
  return api[route]({ method: "GET", path: "", params, query: new URLSearchParams(query), body: undefined });
}

const task = (id: string) => get<any>("GET /tasks/:id", { id });

export const WithChecklist = () => (
  <div className="bg-background p-4" style={{ width: 560 }}>
    <TaskExecution task={task("tsk_welcome_wireframes")} />
  </div>
);

export const Focusing = () => (
  <div className="bg-background p-4" style={{ width: 560 }}>
    <TaskExecution task={{ ...task("tsk_contrast_pass"), focusStartedAt: new Date(Date.now() - 25 * 60_000).toISOString() }} />
  </div>
);

export const EmptyChecklist = () => (
  <div className="bg-background p-4" style={{ width: 560 }}>
    <TaskExecution task={task("tsk_select_docs")} />
  </div>
);

export const Compact = () => (
  <div className="bg-background p-4" style={{ width: 560 }}>
    <TaskExecution task={task("tsk_welcome_wireframes")} compact />
  </div>
);
