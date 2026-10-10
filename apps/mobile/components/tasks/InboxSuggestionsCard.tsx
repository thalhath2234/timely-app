import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Sparkles } from "lucide-react-native";
import TaskSectionHeader from "./TaskSectionHeader";
import AnimatedPressable from "../ui/AnimatedPressable";
import { useDecisionFeedback, useDecisionsStatusQuery, useInboxSuggestionsQuery } from "../../lib/hooks";
import { formatDateAndTime, formatDuration, formatShortDate, formatTime, isSameDay, PRIORITY_META } from "../../lib/format";
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

/** The next whole hour, the time the screen's Reminder choice starts at. */
function nextHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

/** A local date and HH:MM as an ISO time. */
function localAt(date: string, time: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, min).toISOString();
}

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
  // Only the model's own kind changes the item: a place or a length alone
  // does not make it Work, and they only fit once it has a kind, the same as
  // the screen's pickers.
  const kind = s.kind;
  const reminder = kind === "reminder";
  const space = kind ? spaces.find((w) => w.id === s.workspaceId) : undefined;
  const project = kind ? projects.find((p) => p.id === s.projectId && (!space || p.workspaceId === space.id)) : undefined;
  const place = space ?? spaces.find((w) => w.id === project?.workspaceId);
  const duration = s.duration && s.duration > 0 ? s.duration : undefined;
  const workspaceId = place?.id || task.workspaceId || fallbackWorkspaceId || spaces[0]?.id;
  const labelSpace = spaces.find((w) => w.id === workspaceId);
  const labels = (kind ? s.labelIds ?? [] : [])
    .map((id) => labelSpace?.lables?.find((label) => label.id === id))
    .filter((label): label is NonNullable<typeof label> => Boolean(label));
  const priority = normalizePriority(s.priority);

  const lines: string[] = [];
  const update: UpdateTaskPayload = {};
  if (reminder) {
    // A reminder needs a time; this matches the screen's Reminder choice,
    // and the card says when it will ping.
    // A date read from the words wins when Jev says it is the reminder time.
    const pingAt =
      s.dateRole === "reminder" && s.date
        ? localAt(s.date, s.time || "09:00")
        : task.scheduledOn || nextHour();
    const when = isSameDay(new Date(pingAt), new Date()) ? formatTime(pingAt) : formatDateAndTime(pingAt);
    lines.push(`Reminder · pings at ${when}`);
    update.kind = "reminder";
    update.duration = 0;
    update.scheduledOn = pingAt;
  } else if (kind === "task") {
    lines.push(duration ? `Work · ${aboutMinutes(duration)}` : "Work");
    update.kind = "task";
    update.duration = duration ?? (Math.max(30, task.duration || 0) || 30);
    update.workspaceId = workspaceId;
    if (s.date && (s.dateRole === "deadline" || s.dateRole === "start")) {
      const label = formatShortDate(localAt(s.date, "12:00"));
      if (s.dateRole === "deadline") {
        lines.push(`Deadline: ${label}`);
        update.deadline = s.date;
      } else {
        lines.push(`Starts: ${label}`);
        update.startDate = s.date;
      }
    }
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
  // Shown only when the date was not read and filled above.
  const dateUsed = Boolean(s.date) && (reminder ? s.dateRole === "reminder" : kind === "task" && s.dateRole !== "reminder");
  if (s.dateRole && DATE_ROLE[s.dateRole] && !dateUsed) hints.push(DATE_ROLE[s.dateRole]);
  const similar = (s.duplicates ?? []).filter((item) => item.id && item.id !== task.id);

  return { lines, hints, similar, update: Object.keys(update).length > 0 ? update : null };
}

/** Suggested fields for an Inbox item. Renders nothing while loading or when
 * suggestions are off, so the screen behaves as without it; a failed call
 * shows its reason. */
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

  if (!isInbox || closed) return null;
  // A failed call names its reason, as the web Clarify form does.
  if (data?.error && (!plan || (plan.lines.length === 0 && plan.hints.length === 0 && plan.similar.length === 0)))
    return (
      <View style={styles.card} testID="inbox-suggestions-error">
        <TaskSectionHeader icon={<Sparkles size={18} color={colors.primary} />} title="Suggestions" />
        <Text style={styles.hint}>{data.error}</Text>
      </View>
    );
  if (!plan) return null;
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
