import { useState } from "react";
import { Text, View } from "react-native";
import { Sparkles, X } from "lucide-react-native";
import TaskSectionHeader from "./TaskSectionHeader";
import AnimatedPressable from "../ui/AnimatedPressable";
import { useDecisionFeedback, useTaskHintsQuery } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import type { UpdateTaskPayload } from "../../lib/api/tasks";
import type { CustomField, CustomFieldValueInput, Task, Workspace } from "../../lib/types";

type Row = { key: string; text: string; label?: string; apply?: () => void };

const TIME_OF_DAY: Record<string, string> = { morning: "mornings", afternoon: "afternoons", evening: "evenings" };

/** What a task's own words suggest: a status, stage, field values or a
 * blocker to apply one by one, one sitting for long work that cannot be
 * split, the person's best time for deep work, and notes on a vague outcome
 * or a checklist gap. Renders nothing while suggestions are off, loading or
 * unsure. */
export default function TaskHintsCard({
  task,
  workspace,
  stages,
  fieldValues,
  onApply,
  onField,
  onPreferredWindow,
}: {
  task: Task;
  workspace?: Workspace;
  stages: { id: string; name: string }[];
  fieldValues: CustomFieldValueInput[];
  onApply: (data: UpdateTaskPayload) => void;
  onField: (field: CustomField, next: Pick<CustomFieldValueInput, "stringValue" | "optionsValue">) => void;
  onPreferredWindow: (window: { start: string; end: string }) => void;
}) {
  // The same version as web: an edit, a new blocker or stage, or a new length
  // asks again.
  const description = task.description ?? "";
  const version = `${description.length}:${description.slice(-40)}:${task.completedAt ?? ""}:${task.blockedById ?? ""}:${task.stageId ?? ""}:${task.duration ?? 0}`;
  const { data } = useTaskHintsQuery(task.id, version, task.kind === "task");
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<string>();
  if (!data?.available) return null;

  const statuses = workspace?.status ?? [];
  const fields = workspace?.customFields ?? [];
  const filled = new Set(fieldValues.filter((v) => (v.stringValue ?? "") !== "" || (v.optionsValue ?? []).length > 0).map((v) => v.id));
  const rows: Row[] = [];
  const status = statuses.find((s) => s.id === data.statusId);
  if (status && status.id !== task.statusId) {
    rows.push({ key: "status", text: `The description reads like “${status.name}”.`, label: "Set status", apply: () => onApply({ statusId: status.id }) });
  }
  const stage = stages.find((s) => s.id === data.stageId);
  if (stage && !task.stageId) {
    rows.push({ key: "stage", text: `Looks like part of the “${stage.name}” stage.`, label: "Set stage", apply: () => onApply({ stageId: stage.id }) });
  }
  for (const hint of data.fields ?? []) {
    const field = fields.find((f) => f.id === hint.fieldId);
    if (!field || filled.has(field.id)) continue;
    if (field.type === "boolean") {
      rows.push({
        key: `field:${field.id}`,
        text: `${field.name}: ${hint.value === "true" ? "Yes" : "No"}, from the description.`,
        label: "Fill in",
        apply: () => onField(field, { stringValue: hint.value ?? "false" }),
      });
      continue;
    }
    const picked = (field.options?.options ?? []).filter((o) => hint.optionIds?.includes(o.id));
    if (picked.length === 0) continue;
    rows.push({
      key: `field:${field.id}`,
      text: `${field.name}: ${picked.map((o) => o.value).join(", ")}, from the description.`,
      label: "Fill in",
      apply: () => onField(field, { optionsValue: picked.map((o) => ({ id: o.id })) }),
    });
  }
  if (data.blockedBy && !task.blockedById) {
    const blocker = data.blockedBy;
    rows.push({ key: "blocker", text: `Seems to wait on “${blocker.name}”.`, label: "Set as blocker", apply: () => onApply({ blockedById: blocker.id }) });
  }
  if (data.oneSitting && !task.contiguous) {
    rows.push({
      key: "sitting",
      text: "Reads like it needs one unbroken stretch rather than several sessions.",
      label: "Keep in one sitting",
      apply: () => onApply({ contiguous: true }),
    });
  }
  if (data.preferredTime && data.preferredWindow && !(task.preferredWindows ?? []).length) {
    const window = data.preferredWindow;
    const time = TIME_OF_DAY[data.preferredTime];
    rows.push({
      key: "deep-time",
      text: `Deep focus work. Plan it in your ${time} (${window.start}–${window.end}, within your working hours)?`,
      label: `Prefer ${time}`,
      apply: () => onPreferredWindow(window),
    });
  }
  if (data.vagueOutcome) rows.push({ key: "outcome", text: "It is not clear what counts as done. A “done when” line would help." });
  if (data.checklistGap) rows.push({ key: "gap", text: "The description asks for something the checklist does not cover." });
  if (data.notDone) rows.push({ key: "left", text: "Marked complete, but the description or comments say something is left." });
  if (data.openChecklist) {
    rows.push({ key: "open", text: `Marked complete with ${data.openChecklist} unchecked checklist item${data.openChecklist === 1 ? "" : "s"}.` });
  }
  const shown = rows.filter((row) => !hidden.has(row.key));
  if (shown.length === 0) return null;
  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));

  return (
    <View style={styles.card} testID="task-hints">
      <TaskSectionHeader icon={<Sparkles size={18} color={colors.primary} />} title="Suggestions" />
      {shown.map((row) => (
        <View key={row.key} style={styles.row}>
          <Text style={styles.text}>{row.text}</Text>
          <View style={styles.actions}>
            {row.apply ? (
              <AnimatedPressable
                accessibilityRole="button"
                onPress={() => {
                  row.apply!();
                  if (data.logId && sent !== data.logId) {
                    setSent(data.logId);
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
        </View>
      ))}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 10, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  text: { flex: 1, color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  button: { minHeight: 32, borderRadius: 10, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary },
  buttonText: { color: colors.foreground, fontSize: 12, fontWeight: "700" },
  dismiss: { padding: 4 },
}));
