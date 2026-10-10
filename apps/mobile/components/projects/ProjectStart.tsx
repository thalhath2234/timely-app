import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { CheckSquare, Copy, FileText, Sparkles, Square, Table2 } from "lucide-react-native";
import { contentFromTemplate, templateVars } from "@timely/contract/templates";
import { SectionLabel } from "../ui/primitives";
import { useDecisionsStatusQuery } from "../../lib/hooks";
import { getProjectStart, sendDecisionFeedback, type ProjectStart } from "../../lib/api/decisions";
import { createProject, duplicateProject, type CreateProjectPayload } from "../../lib/api/projects";
import { createDoc, getDoc } from "../../lib/api/docs";
import { createSheet } from "../../lib/api/sheets";
import { colors, createThemedStyleSheet } from "../../lib/theme";
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
  const row = (key: keyof StartChoices, icon: ReactNode, text: string) => {
    const Box = choices[key] ? CheckSquare : Square;
    return (
      <Pressable
        key={key}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: choices[key] }}
        onPress={() => onChange({ ...choices, [key]: !choices[key] })}
        style={styles.row}
      >
        <Box size={18} color={choices[key] ? colors.primary : colors.mutedForeground} />
        {icon}
        <Text style={styles.text}>{text}</Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.card} testID="project-start">
      <View style={styles.header}>
        <Sparkles size={14} color={colors.primary} />
        <SectionLabel>Start from</SectionLabel>
      </View>
      {suggestion.copyProjectId
        ? row("copy", <Copy size={14} color={colors.mutedForeground} />, `Copy the stages and tasks of “${suggestion.copyTitle ?? ""}”`)
        : null}
      {suggestion.docTemplateId
        ? row("doc", <FileText size={14} color={colors.mutedForeground} />, `Add a doc from the “${suggestion.docTitle ?? ""}” template`)
        : null}
      {suggestion.sheetTemplateId
        ? row("sheet", <Table2 size={14} color={colors.mutedForeground} />, `Add a sheet from the “${suggestion.sheetTitle ?? ""}” template`)
        : null}
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

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36 },
  text: { flex: 1, color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
}));
