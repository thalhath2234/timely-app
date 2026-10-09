"use client";

import { useEffect, useState } from "react";
import { Copy, FileText, Sparkles, Table2 } from "lucide-react";
import { contentFromTemplate, templateVars } from "@timely/contract/templates";
import type { Project } from "@/app/_types/types";
import { getProjectStart, sendDecisionFeedback, type ProjectStart } from "@/app/utils/api/decisions";
import { createProject, duplicateProject, type CreateProjectPayload } from "@/app/utils/api/projects";
import { createDoc, getDoc } from "@/app/utils/api/docs";
import { createSheet } from "@/app/utils/api/sheets";

export type StartChoices = { copy: boolean; doc: boolean; sheet: boolean };
const none: StartChoices = { copy: false, doc: false, sheet: false };

/** What a new project's title suggests starting from (smart suggestions):
 * a copy of an earlier project, a doc template and a sheet template. Each is
 * offered unticked; the person ticks what they want. */
export function useProjectStart(title: string, workspaceId: string, active: boolean) {
  const [fetched, setFetched] = useState<{ suggestion: ProjectStart; workspaceId: string }>();
  const [choices, setChoices] = useState<StartChoices>(none);
  useEffect(() => {
    const trimmed = title.trim();
    if (!active || !workspaceId || trimmed.length < 3) return;
    let stale = false;
    const timer = setTimeout(() => {
      getProjectStart(trimmed, workspaceId)
        .then((next) => {
          if (stale) return;
          setFetched(next.available ? { suggestion: next, workspaceId } : undefined);
          setChoices(none);
        })
        .catch(() => {});
    }, 700);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [title, workspaceId, active]);
  // A suggestion only counts for the workspace it was asked for; a copy
  // always lands in the source project's workspace.
  const shown = active && title.trim().length >= 3 && fetched?.workspaceId === workspaceId ? fetched.suggestion : undefined;
  return { suggestion: shown, choices, setChoices };
}

export function ProjectStartChoices({
  suggestion,
  choices,
  onChange,
}: {
  suggestion?: ProjectStart;
  choices: StartChoices;
  onChange: (next: StartChoices) => void;
}) {
  if (!suggestion || !(suggestion.copyProjectId || suggestion.docTemplateId || suggestion.sheetTemplateId)) return null;
  const row = (key: keyof StartChoices, icon: React.ReactNode, text: React.ReactNode) => (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm text-muted-foreground hover:bg-accent/40">
      <input
        type="checkbox"
        checked={choices[key]}
        onChange={(event) => onChange({ ...choices, [key]: event.target.checked })}
        className="size-3.5 accent-primary"
      />
      {icon}
      <span className="min-w-0 flex-1">{text}</span>
    </label>
  );
  const strong = (text?: string) => <strong className="font-medium text-foreground">{text}</strong>;
  return (
    <section className="mt-3 rounded-lg border border-border bg-muted/20 p-2" data-testid="project-start" aria-label="Start from">
      <h3 className="mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Sparkles className="size-3.5" /> Start from
      </h3>
      {suggestion.copyProjectId &&
        row("copy", <Copy className="size-3.5 shrink-0" />, <>Copy the stages and tasks of {strong(suggestion.copyTitle)}</>)}
      {suggestion.docTemplateId &&
        row("doc", <FileText className="size-3.5 shrink-0" />, <>Add a doc from the {strong(suggestion.docTitle)} template</>)}
      {suggestion.sheetTemplateId &&
        row("sheet", <Table2 className="size-3.5 shrink-0" />, <>Add a sheet from the {strong(suggestion.sheetTitle)} template</>)}
    </section>
  );
}

/** Creates the project, starting from what the person ticked. A copy keeps
 * the earlier project's stages and tasks and takes this form's fields. */
export async function createProjectWithStart(
  payload: CreateProjectPayload,
  suggestion: ProjectStart | undefined,
  choices: StartChoices,
): Promise<Project> {
  let project: Project;
  if (choices.copy && suggestion?.copyProjectId) {
    project = await duplicateProject(suggestion.copyProjectId, payload);
  } else {
    project = await createProject(payload);
  }
  if (choices.doc && suggestion?.docTemplateId) {
    const template = await getDoc(suggestion.docTemplateId);
    const { content, plainText } = contentFromTemplate(
      { id: template.id, title: template.title, icon: template.icon || "📄", content: template.content },
      templateVars(new Date(), template.title),
    );
    await createDoc({ title: template.title, icon: template.icon || undefined, content, plainText, workspaceId: payload.workspaceId, projectId: project.id });
  }
  if (choices.sheet && suggestion?.sheetTemplateId) {
    await createSheet({ title: suggestion.sheetTitle || payload.title, templateId: suggestion.sheetTemplateId, workspaceId: payload.workspaceId, projectId: project.id });
  }
  if (suggestion?.logId) {
    const used = (choices.copy && suggestion.copyProjectId) || (choices.doc && suggestion.docTemplateId) || (choices.sheet && suggestion.sheetTemplateId);
    void sendDecisionFeedback(suggestion.logId, Boolean(used)).catch(() => {});
  }
  return project;
}
