/**
 * The confirm shown before a project is deleted. Deleting a project deletes
 * its tasks and stages with it (the API cascades), so the dialog names them.
 */
export type ProjectDeleteCopy = { title: string; description: string; confirmLabel: string };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function projectDeleteCopy(name: string, tasks: number, stages: number): ProjectDeleteCopy {
  const title = `Delete “${name.trim() || "Untitled"}”?`;
  const parts = [
    tasks > 0 ? count(tasks, "task", "tasks") : "",
    stages > 0 ? count(stages, "stage", "stages") : "",
  ].filter(Boolean);
  const verb = tasks + stages === 1 ? "is" : "are";
  const description = parts.length
    ? `Its ${parts.join(" and ")} ${verb} deleted with it. This can’t be undone.`
    : "This can’t be undone.";
  const confirmLabel = tasks > 0 ? `Delete project and ${count(tasks, "task", "tasks")}` : "Delete project";
  return { title, description, confirmLabel };
}
