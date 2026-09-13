import type { Project, Stage } from "@/app/_types/types";

export function sortedStages(stages?: Stage[] | null): Stage[] {
  return [...(stages ?? [])].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function projectById(projects: Project[] | undefined, projectId?: string | null) {
  if (!projectId) return undefined;
  return (projects ?? []).find((project) => project.id === projectId);
}

export function stagesForProject(
  projects: Project[] | undefined,
  projectId?: string | null,
): Stage[] {
  return sortedStages(projectById(projects, projectId)?.stages);
}

export function stageNameMap(projects: Project[] | undefined): Record<string, string> {
  const names: Record<string, string> = {};
  for (const project of projects ?? []) {
    for (const stage of project.stages ?? []) {
      names[stage.id] = stage.name;
    }
  }
  return names;
}
