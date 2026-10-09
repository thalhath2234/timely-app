import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Sparkles } from "lucide-react-native";
import TaskSectionHeader from "./TaskSectionHeader";
import AnimatedPressable from "../ui/AnimatedPressable";
import { useDecisionFeedback, useDecisionsStatusQuery, useInboxSuggestionsQuery } from "../../lib/hooks";
import { formatDuration, PRIORITY_META } from "../../lib/format";
import { normalizePriority } from "../../lib/priority";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import type { InboxSuggestions } from "../../lib/api/decisions";
import type { UpdateTaskPayload } from "../../lib/api/tasks";
import type { Project, Task, Workspace } from "../../lib/types";

const MISSING: Record<NonNullable<InboxSuggestions["missing"]>, string> = {
  duration: "Missing: how long it takes",
  place: "Missing: where it belongs",
  date: "Missing: when it happens",
  scope: "Missing: what done looks like",
};

const DATE_ROLE: Record<NonNullable<InboxSuggestions["dateRole"]>, string> = {
  deadline: "The date looks like a deadline",
  start: "The date looks like a start date",
  reminder: "The date looks like a reminder time",
};

function aboutMinutes(minutes: number) {
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `about ${hours} hour${hours === 1 ? "" : "s"}`;
  return `about ${formatDuration(minutes)}`;
}

type Plan = {
  lines: string[];
  hints: string[];
  similar: { id: string; name: string }[];
  update: UpdateTaskPayload | null;
};

/** Turns the model's answer into plain lines and one task update. Ids the
 * app does not know (a deleted workspace, a label from another workspace) are
 * dropped rather than sent. */
function planSuggestions(
  s: InboxSuggestions,
  task: Task,
  spaces: Workspace[],
  projects: Project[],
  fallbackWorkspaceId: string,
): Plan {
  const space = spaces.find((w) => w.id === s.workspaceId);
  const project = projects.find((p) => p.id === s.projectId && (!space || p.workspaceId === space.id));
  const place = space ?? spaces.find((w) => w.id === project?.workspaceId);
  const duration = s.duration && s.duration > 0 ? s.duration : undefined;
  // A place or a length only fits work, the same as the screen's pickers.
  const kind = s.kind ?? (place || duration ? "task" : undefined);
  const reminder = kind === "reminder";
  const workspaceId = place?.id || task.workspaceId || fallbackWorkspaceId || spaces[0]?.id;
  const labelSpace = spaces.find((w) => w.id === workspaceId);
  const labels = (s.labelIds ?? [])
    .map((id) => labelSpace?.lables?.find((label) => label.id === id))
    .filter((label): label is NonNullable<typeof label> => Boolean(label));
  const priority = normalizePriority(s.priority);

  const lines: string[] = [];
  const update: UpdateTaskPayload = {};
  if (reminder) {
    lines.push("Reminder");
    // A reminder needs a time; this matches the screen's Reminder choice.
    update.kind = "reminder";
    update.duration = 0;
    update.scheduledOn = task.scheduledOn || new Date(Date.now() + 60 * 60 * 1000).toISOString();
  } else if (kind === "task") {
    lines.push(duration ? `Work · ${aboutMinutes(duration)}` : "Work");
    update.kind = "task";
    update.duration = duration ?? (Math.max(30, task.duration || 0) || 30);
    update.workspaceId = workspaceId;
  }
  if (place) {
    lines.push(project && !reminder ? `${place.name} › ${project.title}` : place.name);
    update.workspaceId = place.id;
    if (project && !reminder) {
      update.projectId = project.id;
      update.stageId = null;
    }
  }
  if (priority) {
    lines.push(`Priority: ${PRIORITY_META[priority]?.label ?? priority}`);
    update.priorityLevel = priority;
  }
  if (labels.length > 0 && workspaceId) {
    lines.push(`Labels: ${labels.map((label) => label.name).join(", ")}`);
    update.labelIds = labels.map((label) => ({ id: label.id }));
    update.workspaceId = workspaceId;
  }

  const hints: string[] = [];
  if (s.looksLikeEvent) hints.push("Looks like an event");
  if (s.severalActions) hints.push("This may be more than one task");
  if (s.notReady) hints.push("This may need more thought before it becomes work");
  if (s.missing && MISSING[s.missing]) hints.push(MISSING[s.missing]);
  if (s.dateRole && DATE_ROLE[s.dateRole]) hints.push(DATE_ROLE[s.dateRole]);
  const similar = (s.duplicates ?? []).filter((item) => item.id && item.id !== task.id);

  return { lines, hints, similar, update: Object.keys(update).length > 0 ? update : null };
}

/** Suggested fields for an Inbox item. Renders nothing while loading, on an
 * error, or when suggestions are off, so the screen behaves as without it. */
export default function InboxSuggestionsCard({
  task,
  spaces,
  projects,
  fallbackWorkspaceId,
  onApply,
  onOpenTask,
}: {
  task: Task;
  spaces: Workspace[];
  projects: Project[];
  fallbackWorkspaceId: string;
  onApply: (data: UpdateTaskPayload) => void;
  onOpenTask: (id: string) => void;
}) {
  const isInbox = task.kind === "inbox";
  const status = useDecisionsStatusQuery(isInbox);
  const suggestions = useInboxSuggestionsQuery(task.id, isInbox && status.data?.available === true);
  const feedback = useDecisionFeedback();
  const [closed, setClosed] = useState(false);
  const data = suggestions.data;
  const plan = useMemo(
    () => (data?.available ? planSuggestions(data, task, spaces, projects, fallbackWorkspaceId) : null),
    [data, task, spaces, projects, fallbackWorkspaceId],
  );

  if (!isInbox || closed || !plan) return null;
  if (plan.lines.length === 0 && plan.hints.length === 0 && plan.similar.length === 0) return null;

  const answer = (accepted: boolean) => {
    if (data?.logId) feedback.mutate({ logId: data.logId, accepted });
    setClosed(true);
  };

  return (
    <View style={styles.card} testID="inbox-suggestions">
      <TaskSectionHeader icon={<Sparkles size={18} color={colors.primary} />} title="Suggestions" />
      {plan.lines.length > 0 ? (
        <View style={{ gap: 4 }}>
          {plan.lines.map((line) => (
            <Text key={line} style={styles.line}>{line}</Text>
          ))}
        </View>
      ) : null}
      {plan.hints.length > 0 || plan.similar.length > 0 ? (
        <View style={{ gap: 4 }}>
          {plan.hints.map((hint) => (
            <Text key={hint} style={styles.hint}>{hint}</Text>
          ))}
          {plan.similar.map((item) => (
            <Pressable key={item.id} accessibilityRole="link" onPress={() => onOpenTask(item.id)} hitSlop={6}>
              <Text style={styles.hint} numberOfLines={1}>
                Similar: <Text style={styles.link}>{item.name}</Text>
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        {plan.update ? (
          <AnimatedPressable
            accessibilityRole="button"
            onPress={() => {
              onApply(plan.update!);
              answer(true);
            }}
            style={[styles.button, styles.primary]}
          >
            <Text style={styles.primaryText}>Apply</Text>
          </AnimatedPressable>
        ) : null}
        <AnimatedPressable accessibilityRole="button" onPress={() => answer(false)} style={[styles.button, styles.secondary]}>
          <Text style={styles.secondaryText}>Dismiss</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 10, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 16 },
  line: { color: colors.foreground, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, flexShrink: 1 },
  link: { color: colors.primary, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 8 },
  button: { flex: 1, minHeight: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.secondary },
  primaryText: { color: colors.primaryForeground, fontSize: 13, fontWeight: "700" },
  secondaryText: { color: colors.foreground, fontSize: 13, fontWeight: "700" },
}));
