import { useEffect, useState } from "react";
import { View } from "react-native";
import { contentFromTemplate, templateVars } from "@timely/contract/templates";
import { GroupLabel, ListGroup, SwitchRow } from "../settings/SettingsList";
import { useDecisionsStatusQuery } from "../../lib/hooks";
import { getProjectStart, sendDecisionFeedback, type ProjectStart } from "../../lib/api/decisions";
import { createProject, duplicateProject, type CreateProjectPayload } from "../../lib/api/projects";
import { createDoc, getDoc } from "../../lib/api/docs";
import { createSheet } from "../../lib/api/sheets";
import type { Project } from "../../lib/types";

export type StartChoices = { copy: boolean; doc: boolean; sheet: boolean };
const none: StartChoices = { copy: false, doc: false, sheet: false };

/** What a new project's title suggests starting from (smart suggestions):
 * a copy of an earlier project, a doc template and a sheet template. Each is
 * offered unticked; the person ticks what they want. Quiet while suggestions
 * are off. */
export function useProjectStart(title: string, workspaceId: string) {
  const status = useDecisionsStatusQuery();
  const active = status.data?.available === true;
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
  const row = (key: keyof StartChoices, title: string, meta: string) => (
    <SwitchRow key={key} title={title} meta={meta} value={choices[key]} onChange={(next) => onChange({ ...choices, [key]: next })} />
  );
  return (
    <View testID="project-start">
      <GroupLabel aside="Suggested">Start from</GroupLabel>
      <ListGroup>
        {suggestion.copyProjectId ? row("copy", "Copy stages and tasks", `From “${suggestion.copyTitle ?? ""}”`) : null}
        {suggestion.docTemplateId ? row("doc", "Add a doc", `From the “${suggestion.docTitle ?? ""}” template`) : null}
        {suggestion.sheetTemplateId ? row("sheet", "Add a sheet", `From the “${suggestion.sheetTitle ?? ""}” template`) : null}
      </ListGroup>
    </View>
  );
}

/** Creates the project, starting from what the person ticked. A copy keeps
 * the earlier project's stages and tasks and takes this form's fields. */
export async function createProjectWithStart(
  payload: CreateProjectPayload,
  suggestion: ProjectStart | undefined,
  choices: StartChoices,
): Promise<Project> {
  const project =
    choices.copy && suggestion?.copyProjectId
      ? await duplicateProject(suggestion.copyProjectId, payload)
      : await createProject(payload);
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
