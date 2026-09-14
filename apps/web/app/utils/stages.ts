import type { Project, Stage } from "@/app/_types/types";
import { resolvedColor } from "@/app/utils/entityColor";

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

export function stageColorMap(projects: Project[] | undefined): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const project of projects ?? []) {
    const ordered = sortedStages(project.stages);
    ordered.forEach((stage, index) => {
      colors[stage.id] = resolvedColor(stage.color, undefined, index);
    });
  }
  return colors;
}

export function stageCode(name: string, index: number): string {
  const leading = name.trim().match(/^([A-Za-z]?\d+)\b/);
  if (leading) return leading[1].toUpperCase();
  return `S${index + 1}`;
}
