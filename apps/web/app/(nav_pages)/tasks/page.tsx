"use client";

import { useQuery } from "@tanstack/react-query";
import { getTasks, Task } from "@/app/lib/api/tasks";
import { getWorkspaces, Workspace } from "@/app/lib/api/worksapce";

export default function Tasks() {
  const {
    data: tasks,
    isLoading,
    error,
  } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: getTasks,
  });

  const {
    data: workspace,
  } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: getWorkspaces,
  });

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Something went wrong</div>;
  }

  return (
    <table className="w-full text-sm">
  <thead>
    <tr className="border-b">
      <th className="text-left p-2">Name</th>
      <th className="text-left p-2">Project</th>
      <th className="text-left p-2">Status</th>
      <th className="text-left p-2">Priority</th>
      <th className="text-left p-2">Blocked By</th>
      <th className="text-left p-2">Workspace</th>
      <th className="text-left p-2">Duration</th>
    </tr>
  </thead>

  <tbody>
    {tasks?.map((task) => (
      <tr key={task.id} className="border-b">
        <td className="p-2">{task.name}</td>
        <td className="p-2">{task.project?.name ?? "-"}</td>
        <td className="p-2">{task.status?.name ?? "-"}</td>
        <td className="p-2">{task.priority?.name ?? "-"}</td>
        <td className="p-2">{task.blockedBy?.name ?? "-"}</td>
        <td className="p-2">{task.workspace?.name ?? "-"}</td>
        <td className="p-2">{task.duration} min</td>
      </tr>
    ))}
  </tbody>
</table>
  );
}