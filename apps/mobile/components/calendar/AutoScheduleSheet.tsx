import { ScrollView, StyleSheet, Text, View } from "react-native";
import BottomSheet from "../ui/BottomSheet";
import { PrimaryButton } from "../ui/primitives";
import { useApplySchedule, usePreviewSchedule } from "../../lib/hooks";
import { formatShortDate, formatTime } from "../../lib/format";
import { colors } from "../../lib/theme";

export default function AutoScheduleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const preview = usePreviewSchedule();
  const apply = useApplySchedule();
  const plan = preview.data ?? apply.data;

  return (
    <BottomSheet open={open} onClose={onClose} title="Auto-schedule">
      <Text style={styles.hint}>The engine places unscheduled tasks into free working hours.</Text>
      <PrimaryButton
        label={preview.isPending ? "Previewing…" : "Preview plan"}
        disabled={preview.isPending}
        onPress={() => preview.mutate({})}
      />
      {plan ? (
        <ScrollView style={{ maxHeight: 280, marginTop: 16 }}>
          <Text style={styles.stat}>
            {plan.proposals.length} placed · {plan.skipped.length} skipped · {plan.plannedMinutes} min
          </Text>
          {plan.proposals.map((p) => (
            <View key={p.taskId} style={styles.row}>
              <Text style={styles.name}>{p.taskName}</Text>
              <Text style={styles.meta}>
                {p.blocks
                  .slice(0, 2)
                  .map((b) => `${formatShortDate(b.start)} ${formatTime(b.start)}`)
                  .join(" · ")}
                {p.pastDeadline ? " · past deadline" : ""}
              </Text>
            </View>
          ))}
          {plan.skipped.map((s) => (
            <Text key={s.taskId} style={styles.skip}>
              {s.taskName}: {s.reason.replaceAll("_", " ")}
            </Text>
          ))}
        </ScrollView>
      ) : null}
      <View style={{ height: 12 }} />
      <PrimaryButton
        label={apply.isPending ? "Applying…" : "Apply plan"}
        disabled={!plan || apply.isPending}
        onPress={() => {
          apply.mutate({}, { onSuccess: onClose });
        }}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.mutedForeground, fontSize: 13, marginBottom: 12 },
  stat: { color: colors.foreground, fontSize: 13, fontWeight: "600", marginBottom: 8 },
  row: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  name: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  meta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  skip: { color: colors.warning, fontSize: 12, marginTop: 6 },
});
