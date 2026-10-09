import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Sparkles, X } from "lucide-react-native";
import AnimatedPressable from "../ui/AnimatedPressable";
import { SectionLabel } from "../ui/primitives";
import { useCreateTask, useDecisionFeedback, useProjectInsightsQuery, useSaveTask } from "../../lib/hooks";
import { showUndoToast } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import type { ProjectInsights } from "../../lib/api/decisions";
import type { Project } from "../../lib/types";

const HEALTH: Record<NonNullable<ProjectInsights["health"]>, string> = {
  progressing: "Progressing",
  stalled: "Stalled",
  blocked: "Blocked",
};

function factLine(f: ProjectInsights["facts"]) {
  const parts = [`${f.open} open`, `${f.doneRecent} done in two weeks`];
  if (f.overdue) parts.push(`${f.overdue} overdue`);
  if (f.blocked) parts.push(`${f.blocked} waiting`);
  if (f.idleDays >= 7) parts.push(`idle ${f.idleDays} days`);
  if (f.daysLeft !== undefined) parts.push(f.daysLeft < 0 ? `${-f.daysLeft} days past the deadline` : `${f.daysLeft} days left`);
  return parts.join(" · ");
}

type Row = { key: string; text: string; label?: string; run?: () => void; open?: () => void };

/** How the project is going and what its brief and tasks are missing, from
 * smart suggestions. Renders nothing while suggestions are off. */
export default function ProjectInsightsCard({ project }: { project: Project }) {
  const router = useRouter();
  const { data, refetch } = useProjectInsightsQuery(project.id, `${(project.description ?? "").length}:${project.updatedAt ?? ""}`);
  const createTask = useCreateTask();
  const saveTask = useSaveTask();
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  if (!data?.available || project.completedAt) return null;

  const rows: Row[] = [];
  if (data.noBrief) rows.push({ key: "brief", text: "No brief yet. Say what this project is for and what done looks like." });
  else if (data.noOutcome) rows.push({ key: "outcome", text: "The brief does not say what result finishes the project." });
  if (data.noNextAction) {
    rows.push({ key: "next", text: data.facts.open === 0 ? "No open tasks. Add the next step." : "None of the open tasks reads like a clear next step." });
  }
  for (const req of data.uncovered ?? []) {
    rows.push({
      key: `req:${req}`,
      text: `No task covers “${req}” from the brief.`,
      label: "Add task",
      run: () =>
        void createTask
          .mutateAsync({ name: req, kind: "task", duration: 30, projectId: project.id, workspaceId: project.workspaceId ?? undefined })
          .then(() => refetch()),
    });
  }
  for (const m of data.misfiled ?? []) {
    rows.push({
      key: `move:${m.taskId}`,
      text: m.moveToTitle ? `“${m.name}” looks like it belongs in ${m.moveToTitle}.` : `“${m.name}” may not belong in this project.`,
      open: () => router.push(`/(app)/tasks/${m.taskId}`),
      ...(m.moveTo
        ? {
            label: "Move",
            run: () => {
              saveTask.mutate({ id: m.taskId, data: { projectId: m.moveTo, stageId: null } });
              showUndoToast(`Moved to ${m.moveToTitle}`, () => saveTask.mutate({ id: m.taskId, data: { projectId: project.id } }));
            },
          }
        : {}),
    });
  }
  for (const p of data.overlaps ?? []) {
    rows.push({ key: `overlap:${p.id}`, text: `Overlaps with “${p.title}”.`, open: () => router.push(`/(app)/projects/${p.id}`) });
  }
  const shown = rows.filter((row) => !hidden.has(row.key));
  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));

  return (
    <View style={styles.card} testID="project-insights">
      <View style={styles.header}>
        <Sparkles size={16} color={colors.primary} />
        <SectionLabel>Insights</SectionLabel>
        {data.health ? <Text style={[styles.health, styles[data.health]]}>{HEALTH[data.health]}</Text> : null}
      </View>
      <Text style={styles.facts}>{factLine(data.facts)}</Text>
      {shown.map((row) => (
        <View key={row.key} style={styles.row}>
          <Pressable style={{ flex: 1 }} disabled={!row.open} onPress={row.open}>
            <Text style={[styles.text, row.open ? styles.link : null]}>{row.text}</Text>
          </Pressable>
          {row.run ? (
            <AnimatedPressable
              accessibilityRole="button"
              onPress={() => {
                row.run!();
                if (data.logId && !sent) {
                  setSent(true);
                  feedback.mutate({ logId: data.logId, accepted: true });
                }
                hide(row.key);
              }}
              style={styles.button}
            >
              <Text style={styles.buttonText}>{row.label}</Text>
            </AnimatedPressable>
          ) : null}
          <AnimatedPressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => hide(row.key)} style={styles.dismiss} hitSlop={8}>
            <X size={14} color={colors.mutedForeground} />
          </AnimatedPressable>
        </View>
      ))}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  health: { marginLeft: "auto", overflow: "hidden", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontSize: 12, fontWeight: "700" },
  progressing: { color: colors.success, backgroundColor: colors.secondary },
  stalled: { color: colors.warning, backgroundColor: colors.secondary },
  blocked: { color: colors.destructive, backgroundColor: colors.secondary },
  facts: { color: colors.mutedForeground, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  link: { color: colors.foreground },
  button: { minHeight: 32, borderRadius: 10, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary },
  buttonText: { color: colors.foreground, fontSize: 12, fontWeight: "700" },
  dismiss: { padding: 4 },
}));
