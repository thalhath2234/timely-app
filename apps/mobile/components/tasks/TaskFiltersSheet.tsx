import { Pressable, Text, View } from "react-native";
import BottomSheet from "../ui/BottomSheet";
import { Chip, PrimaryButton, SectionLabel } from "../ui/primitives";
import { PRIORITIES } from "../../lib/priority";
import type { ExtraTaskFilters } from "../../lib/taskFilters";
import { EMPTY_EXTRA_FILTERS } from "../../lib/taskFilters";
import type { NamedStatusGroup } from "../../lib/status";
import type { Label, Stage } from "../../lib/types";
import { createThemedStyleSheet } from "../../lib/theme";

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export default function TaskFiltersSheet({
  open,
  onClose,
  value,
  onChange,
  statusGroups,
  labels,
  stages,
}: {
  open: boolean;
  onClose: () => void;
  value: ExtraTaskFilters;
  onChange: (next: ExtraTaskFilters) => void;
  statusGroups: NamedStatusGroup[];
  labels: Label[];
  stages: Stage[];
}) {
  function toggleStatusGroup(group: NamedStatusGroup) {
    const ids = group.statuses.map((status) => status.id);
    const allOn = ids.every((id) => value.statusIds.includes(id));
    onChange({
      ...value,
      statusIds: allOn
        ? value.statusIds.filter((id) => !ids.includes(id))
        : [...new Set([...value.statusIds, ...ids])],
    });
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <View style={styles.footer}>
          <Pressable onPress={() => onChange(EMPTY_EXTRA_FILTERS)} style={styles.reset}>
            <Text style={styles.resetText}>Reset</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <PrimaryButton label="Done" onPress={onClose} />
          </View>
        </View>
      }
    >
      <View style={styles.block}>
        <SectionLabel>Quick</SectionLabel>
        <View style={styles.row}>
          <Chip
            label="Overdue"
            active={value.onlyOverdue}
            onPress={() => onChange({ ...value, onlyOverdue: !value.onlyOverdue })}
          />
          <Chip
            label="Scheduled"
            active={value.onlyScheduled}
            onPress={() => onChange({ ...value, onlyScheduled: !value.onlyScheduled })}
          />
          <Chip
            label="Recurring"
            active={value.onlyRecurring}
            onPress={() => onChange({ ...value, onlyRecurring: !value.onlyRecurring })}
          />
          <Chip
            label="Dated"
            active={value.onlyDated}
            onPress={() => onChange({ ...value, onlyDated: !value.onlyDated })}
          />
        </View>
      </View>

      {statusGroups.length > 0 ? (
        <View style={styles.block}>
          <SectionLabel>Status</SectionLabel>
          <View style={styles.row}>
            {statusGroups.map((group) => (
              <Chip
                key={group.key}
                label={group.name}
                color={group.color}
                active={group.statuses.some((status) => value.statusIds.includes(status.id))}
                onPress={() => toggleStatusGroup(group)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.block}>
        <SectionLabel>Priority</SectionLabel>
        <View style={styles.row}>
          {PRIORITIES.map((level) => (
            <Chip
              key={level}
              label={level}
              active={value.priorityLevels.includes(level)}
              onPress={() => onChange({ ...value, priorityLevels: toggleId(value.priorityLevels, level) })}
            />
          ))}
        </View>
      </View>

      {labels.length > 0 ? (
        <View style={styles.block}>
          <SectionLabel>Labels</SectionLabel>
          <View style={styles.row}>
            {labels.map((label) => (
              <Chip
                key={label.id}
                label={label.name}
                color={label.color}
                active={value.labelIds.includes(label.id)}
                onPress={() => onChange({ ...value, labelIds: toggleId(value.labelIds, label.id) })}
              />
            ))}
          </View>
        </View>
      ) : null}

      {stages.length > 0 ? (
        <View style={styles.block}>
          <SectionLabel>Stage</SectionLabel>
          <View style={styles.row}>
            {stages.map((stage) => (
              <Chip
                key={stage.id}
                label={stage.name}
                active={value.stageIds.includes(stage.id)}
                onPress={() => onChange({ ...value, stageIds: toggleId(value.stageIds, stage.id) })}
              />
            ))}
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  block: { gap: 8, marginBottom: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: { flexDirection: "row", alignItems: "center", gap: 12 },
  reset: { paddingHorizontal: 12, paddingVertical: 12 },
  resetText: { color: colors.mutedForeground, fontWeight: "600" },
}));
