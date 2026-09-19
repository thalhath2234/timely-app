import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AlertTriangle, CalendarDays, Check, Clock3, Eye, Pin, RotateCcw } from "lucide-react-native";
import BottomSheet from "../ui/BottomSheet";
import { useApplySchedule, usePreviewSchedule, useTasksQuery, useUndoSchedule } from "../../lib/hooks";
import { formatShortDate, formatTime, PRIORITY_META } from "../../lib/format";
import { normalizePriority } from "../../lib/priority";
import { colors, createThemedStyleSheet } from "../../lib/theme";

function scheduleItemLabel(name?: string | null) {
  const title = name?.trim();
  if (title && !/^tsk_/i.test(title)) return title;
  return "Untitled";
}

function blockSummary(start: string, end?: string) {
  return `${formatShortDate(start)} ${formatTime(start)}${end ? ` – ${formatTime(end)}` : ""}`;
}

export default function AutoScheduleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const preview = usePreviewSchedule();
  const apply = useApplySchedule();
  const undo = useUndoSchedule();
  const tasks = useTasksQuery().data ?? [];
  const [applied, setApplied] = useState(false);
  const plan = (applied && apply.data) || preview.data;
  const skipped = (plan?.skipped ?? []).filter((item) => item.reason !== "recurring" && item.reason !== "completed");
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const total = (plan?.proposals.length ?? 0) + skipped.length;
  const matched = total ? Math.round(((plan?.proposals.length ?? 0) / total) * 100) : 0;

  const footer = plan ? (
    <View style={styles.footerActions}>
      {plan.canUndo || applied ? (
        <Pressable
          disabled={undo.isPending}
          onPress={() => {
            undo.mutate(undefined, {
              onSuccess: () => {
                setApplied(false);
                preview.mutate({});
              },
            });
          }}
          style={[styles.footerButton, styles.undoButton, undo.isPending && styles.disabled]}
        >
          <RotateCcw size={16} color="#FFFFFF" />
          <Text style={styles.footerPrimaryText}>{undo.isPending ? "Undoing…" : "Undo last apply"}</Text>
        </Pressable>
      ) : null}
      <Pressable
        disabled={apply.isPending || applied}
        onPress={() => apply.mutate({}, { onSuccess: () => setApplied(true) })}
        style={[styles.footerButton, styles.applyButton, (apply.isPending || applied) && styles.disabled]}
      >
        <Check size={16} color={applied ? colors.success : colors.foreground} strokeWidth={2.5} />
        <Text style={styles.footerSecondaryText}>
          {apply.isPending ? "Applying…" : applied ? "Applied" : "Apply plan"}
        </Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <BottomSheet open={open} onClose={onClose} title="Auto-schedule" footer={footer}>
      {applied ? (
        <Text style={styles.hint}>Schedule applied. Undo restores previous engine blocks and manual slots.</Text>
      ) : null}

      <Pressable
        disabled={preview.isPending}
        onPress={() => {
          setApplied(false);
          preview.mutate({});
        }}
        style={[styles.previewButton, preview.isPending && styles.disabled]}
      >
        <Eye size={16} color="#FFFFFF" />
        <Text style={styles.previewText}>{preview.isPending ? "Building plan…" : "Preview plan"}</Text>
      </Pressable>

      {plan ? (
        <>
          <View style={styles.metrics}>
            <MetricChip color={colors.success} label={`${plan.proposals.length} placed`} />
            <MetricChip color={colors.warning} label={`${skipped.length} skipped`} />
            <View style={styles.minutesChip}>
              <Clock3 size={12} color={colors.mutedForeground} />
              <Text style={styles.minutesStrong}>{plan.plannedMinutes.toLocaleString()}</Text>
              <Text style={styles.minutesText}>min</Text>
            </View>
            <Text style={styles.matched}>{matched}% matched</Text>
          </View>

          {(plan.risks ?? []).length > 0 || (plan.capacity ?? []).some((day) => day.overCapacity || day.atRisk) ? (
            <View style={styles.riskPanel}>
              <AlertTriangle size={15} color={colors.destructive} />
              <View style={{ flex: 1, gap: 4 }}>
                {(plan.risks ?? []).map((risk, index) => (
                  <Text key={`${risk.kind}-${risk.taskId ?? index}`} style={styles.riskText}>
                    {risk.taskName ? `${risk.taskName}: ` : ""}{risk.message}
                  </Text>
                ))}
                {(plan.capacity ?? []).some((day) => day.overCapacity || day.atRisk) ? (
                  <Text style={styles.riskText}>Some days are over capacity or at risk. Review those placements before applying.</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Scheduled allocations</Text>
            <Text style={styles.lockText}>Optimistic lock active</Text>
          </View>
          <View style={styles.list}>
            {plan.proposals.map((proposal) => {
              const task = taskById.get(proposal.taskId);
              const priority = normalizePriority(task?.priorityLevel);
              const priorityMeta = priority ? PRIORITY_META[priority] : null;
              const first = proposal.blocks[0];
              return (
                <View key={`${proposal.taskId}-${first?.occurrenceStart ?? first?.start ?? ""}`} style={styles.allocationCard}>
                  <View style={styles.cardTop}>
                    <View style={styles.cardTitleRow}>
                      <View style={[styles.priorityDot, { backgroundColor: priorityMeta?.color ?? colors.mutedForeground }]} />
                      <Text numberOfLines={2} style={styles.name}>{scheduleItemLabel(proposal.taskName)}</Text>
                    </View>
                    {priorityMeta ? (
                      <View style={[styles.priorityPill, { borderColor: `${priorityMeta.color}55`, backgroundColor: `${priorityMeta.color}1F` }]}>
                        <Text style={[styles.priorityText, { color: priorityMeta.color }]}>{priorityMeta.label}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.cardMetaRow}>
                    <View style={styles.dateRow}>
                      <CalendarDays size={13} color={colors.primary} />
                      <Text style={styles.dateText}>{first ? blockSummary(first.start, first.end) : "No placement"}</Text>
                    </View>
                    <Text numberOfLines={1} style={proposal.pastDeadline ? styles.lateText : styles.changeText}>
                      {proposal.pastDeadline ? "Past deadline" : proposal.change || proposal.reason || "Unscheduled → placed"}
                    </Text>
                  </View>
                  {proposal.blocks.length > 1 ? (
                    <Text style={styles.moreBlocks}>+{proposal.blocks.length - 1} additional block{proposal.blocks.length === 2 ? "" : "s"}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>

          {(plan.changes ?? []).length > 0 ? (
            <View style={styles.changesPanel}>
              {(plan.changes ?? []).slice(0, 6).map((change, index) => (
                <Text key={`${change.action}-${change.taskId}-${index}`} style={styles.changeLine}>
                  {scheduleItemLabel(change.taskName)} · {change.message}
                </Text>
              ))}
            </View>
          ) : null}

          {skipped.length > 0 ? (
            <>
              <View style={styles.sectionHeader}>
                <View style={styles.skippedTitleRow}>
                  <AlertTriangle size={13} color={colors.warning} />
                  <Text style={[styles.sectionTitle, { color: colors.warning }]}>Preserved & skipped</Text>
                </View>
                <Text style={styles.policyText}>Policy aware</Text>
              </View>
              <View style={styles.list}>
                {skipped.map((item) => (
                  <View key={item.taskId} style={styles.skipCard}>
                    <Pin size={14} color={colors.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.skipName}>{scheduleItemLabel(item.taskName)}</Text>
                      <Text style={styles.skipReason}>{item.message || item.reason.replaceAll("_", " ")}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : (
        <View style={styles.emptyState}>
          <Clock3 size={22} color={colors.mutedForeground} />
          <Text style={styles.emptyTitle}>No plan preview yet</Text>
          <Text style={styles.emptyCopy}>Preview the plan to inspect placements and anything the scheduler will preserve.</Text>
        </View>
      )}
    </BottomSheet>
  );
}

function MetricChip({ color, label }: { color: string; label: string }) {
  return (
    <View style={[styles.metricChip, { borderColor: `${color}55`, backgroundColor: `${color}18` }]}>
      <View style={[styles.metricDot, { backgroundColor: color }]} />
      <Text style={[styles.metricText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  hint: { color: colors.mutedForeground, fontSize: 11, lineHeight: 16, marginBottom: 12 },
  previewButton: { minHeight: 44, borderRadius: 12, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: colors.ring },
  previewText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.55 },
  metrics: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, marginTop: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  metricChip: { height: 28, borderRadius: 14, borderWidth: 1, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 },
  metricDot: { width: 6, height: 6, borderRadius: 3 },
  metricText: { fontFamily: "SpaceMono", fontSize: 10, fontWeight: "700" },
  minutesChip: { height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.04)", paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 4 },
  minutesStrong: { color: colors.foreground, fontFamily: "SpaceMono", fontSize: 10, fontWeight: "700" },
  minutesText: { color: colors.mutedForeground, fontFamily: "SpaceMono", fontSize: 9 },
  matched: { marginLeft: "auto", color: colors.mutedForeground, fontFamily: "SpaceMono", fontSize: 9 },
  riskPanel: { marginTop: 12, padding: 11, borderRadius: 12, borderWidth: 1, borderColor: "rgba(244,63,94,0.28)", backgroundColor: "rgba(244,63,94,0.08)", flexDirection: "row", alignItems: "flex-start", gap: 8 },
  riskText: { color: colors.destructive, fontSize: 11, lineHeight: 16 },
  sectionHeader: { marginTop: 16, marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  sectionTitle: { color: colors.mutedForeground, fontFamily: "SpaceMono", fontSize: 9, fontWeight: "700", letterSpacing: 0.7, textTransform: "uppercase" },
  lockText: { color: colors.success, fontFamily: "SpaceMono", fontSize: 8, fontWeight: "700", textTransform: "uppercase" },
  policyText: { color: colors.mutedForeground, fontFamily: "SpaceMono", fontSize: 8, textTransform: "uppercase" },
  list: { gap: 8 },
  allocationCard: { padding: 11, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: 7 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  cardTitleRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  priorityDot: { width: 7, height: 7, borderRadius: 4, marginTop: 5 },
  name: { flex: 1, color: colors.foreground, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  priorityPill: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  priorityText: { fontSize: 8, fontWeight: "800", textTransform: "uppercase" },
  cardMetaRow: { paddingLeft: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dateRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  dateText: { color: colors.foreground, fontFamily: "SpaceMono", fontSize: 9 },
  changeText: { maxWidth: "40%", color: colors.mutedForeground, fontSize: 9, textAlign: "right" },
  lateText: { maxWidth: "40%", color: colors.destructive, fontSize: 9, fontWeight: "700", textAlign: "right" },
  moreBlocks: { paddingLeft: 15, color: colors.mutedForeground, fontFamily: "SpaceMono", fontSize: 9 },
  changesPanel: { marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.025)", padding: 10, gap: 5 },
  changeLine: { color: colors.mutedForeground, fontSize: 10, lineHeight: 15 },
  skippedTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  skipCard: { padding: 11, borderRadius: 12, borderWidth: 1, borderColor: "rgba(245,158,11,0.24)", backgroundColor: "rgba(245,158,11,0.06)", flexDirection: "row", alignItems: "flex-start", gap: 8 },
  skipName: { color: colors.foreground, fontSize: 11, fontWeight: "700" },
  skipReason: { color: colors.warning, fontSize: 10, lineHeight: 15, marginTop: 2 },
  emptyState: { minHeight: 180, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 8 },
  emptyTitle: { color: colors.foreground, fontSize: 14, fontWeight: "700" },
  emptyCopy: { color: colors.mutedForeground, fontSize: 11, lineHeight: 16, textAlign: "center" },
  footerActions: { gap: 8 },
  footerButton: { height: 48, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1 },
  undoButton: { backgroundColor: colors.primary, borderColor: colors.ring, shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  applyButton: { backgroundColor: colors.muted, borderColor: colors.border },
  footerPrimaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  footerSecondaryText: { color: colors.foreground, fontSize: 13, fontWeight: "700" },
}));
