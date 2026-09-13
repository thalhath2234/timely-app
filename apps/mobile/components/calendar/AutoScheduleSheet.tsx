import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import BottomSheet from "../ui/BottomSheet";
import { PrimaryButton } from "../ui/primitives";
import { useApplySchedule, usePreviewSchedule, useUndoSchedule } from "../../lib/hooks";
import { formatShortDate, formatTime } from "../../lib/format";
import { colors, createThemedStyleSheet } from "../../lib/theme";

function scheduleItemLabel(name?: string | null) {
  const title = name?.trim();
  if (title && !/^tsk_/i.test(title)) return title;
  return "Untitled";
}

export default function AutoScheduleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const preview = usePreviewSchedule();
  const apply = useApplySchedule();
  const undo = useUndoSchedule();
  const [applied, setApplied] = useState(false);
  const plan = (applied && apply.data) || preview.data;
  const skipped = (plan?.skipped ?? []).filter((item) => item.reason !== "recurring" && item.reason !== "completed");

  return (
    <BottomSheet open={open} onClose={onClose} title="Auto-schedule">
      <Text style={styles.hint}>
        {applied
          ? "Schedule applied. Undo restores the previous engine blocks."
          : "The engine places unscheduled work into free working hours. Scores are ordering hints, not certainty."}
      </Text>
      <PrimaryButton
        label={preview.isPending ? "Previewing…" : "Preview plan"}
        disabled={preview.isPending}
        onPress={() => {
          setApplied(false);
          preview.mutate({});
        }}
      />
      {plan ? (
        <ScrollView style={{ maxHeight: 280, marginTop: 16 }}>
          <Text style={styles.stat}>
            {plan.proposals.length} placed · {skipped.length} skipped · {plan.plannedMinutes} min
          </Text>
          {(plan.risks ?? []).map((risk, index) => (
            <Text key={`${risk.kind}-${risk.taskId ?? index}`} style={styles.risk}>
              {risk.taskName ? `${risk.taskName}: ` : ""}
              {risk.message}
            </Text>
          ))}
          {(plan.capacity ?? []).some((day) => day.overCapacity || day.atRisk) ? (
            <Text style={styles.risk}>
              Some days are over capacity or at risk. That is a warning, not a certainty.
            </Text>
          ) : null}
          {(plan.changes ?? []).map((change, index) => (
            <Text key={`${change.action}-${change.taskId}-${index}`} style={styles.meta}>
              {scheduleItemLabel(change.taskName)}: {change.message}
            </Text>
          ))}
          {plan.proposals.map((p) => (
            <View key={`${p.taskId}-${p.blocks[0]?.occurrenceStart ?? ""}`} style={styles.row}>
              <Text style={styles.name}>{scheduleItemLabel(p.taskName)}</Text>
              <Text style={styles.meta}>
                {p.blocks
                  .slice(0, 2)
                  .map((b) => `${formatShortDate(b.start)} ${formatTime(b.start)}`)
                  .join(" · ")}
                {p.pastDeadline ? " · past deadline" : ""}
              </Text>
              {p.reason ? <Text style={styles.meta}>{p.reason}</Text> : null}
            </View>
          ))}
          {skipped.map((s) => (
            <Text key={s.taskId} style={styles.skip}>
              {s.taskName}: {s.message || s.reason.replaceAll("_", " ")}
            </Text>
          ))}
        </ScrollView>
      ) : null}
      <View style={{ height: 12 }} />
      {plan?.canUndo || applied ? (
        <PrimaryButton
          label={undo.isPending ? "Undoing…" : "Undo last apply"}
          disabled={undo.isPending}
          onPress={() => {
            undo.mutate(undefined, {
              onSuccess: () => {
                setApplied(false);
                preview.mutate({});
              },
            });
          }}
        />
      ) : null}
      <View style={{ height: 8 }} />
      <PrimaryButton
        label={apply.isPending ? "Applying…" : applied ? "Applied" : "Apply plan"}
        disabled={!plan || apply.isPending || applied}
        onPress={() => {
          apply.mutate({}, { onSuccess: () => setApplied(true) });
        }}
      />
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  hint: { color: colors.mutedForeground, fontSize: 13, marginBottom: 12 },
  stat: { color: colors.foreground, fontSize: 13, fontWeight: "600", marginBottom: 8 },
  row: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  name: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  skip: { color: colors.warning, fontSize: 12, marginTop: 6 },
  risk: { color: colors.destructive, fontSize: 12, marginTop: 6 },
}));
