import { Text, View } from "react-native";
import BottomSheet from "../ui/BottomSheet";
import { PrimaryButton, SectionLabel, Select } from "../ui/primitives";
import AnimatedPressable from "../ui/AnimatedPressable";
import { PRIORITIES } from "../../lib/priority";
import type { ExtraTaskFilters } from "../../lib/taskFilters";
import { EMPTY_EXTRA_FILTERS } from "../../lib/taskFilters";
import type { NamedStatusGroup } from "../../lib/status";
import type { Label, Project, Stage, Workspace } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function FilterChip({
  label,
  active,
  color,
  onPress,
}: {
  label: string;
  active?: boolean;
  color?: string | null;
  onPress: () => void;
}) {
  const tint = color && active ? `${color}33` : undefined;
  const border = color ? (active ? `${color}88` : colors.border) : undefined;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      hitSlop={8}
      onPress={onPress}
      style={[
        styles.chip,
        active && !color ? styles.chipOn : null,
        color ? { borderColor: border, backgroundColor: tint || colors.card } : null,
      ]}
    >
      {color ? <View style={[styles.chipDot, { backgroundColor: color }]} /> : null}
      <Text
        style={[
          styles.chipText,
          active && !color ? { color: colors.primaryForeground } : null,
          active && color ? { color } : null,
        ]}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

export default function TaskFiltersSheet({
  open,
  onClose,
  value,
  onChange,
  defaults = EMPTY_EXTRA_FILTERS,
  statusGroups,
  labels,
  stages,
  workspaces = [],
  projects = [],
}: {
  open: boolean;
  onClose: () => void;
  value: ExtraTaskFilters;
  onChange: (next: ExtraTaskFilters) => void;
  defaults?: ExtraTaskFilters;
  statusGroups: NamedStatusGroup[];
  labels: Label[];
  stages: Stage[];
  workspaces?: Workspace[];
  projects?: Project[];
}) {
  const workspaceId = value.workspaceIds?.[0] ?? "";
  const projectId = value.projectIds?.[0] ?? "";
  const scopedProjects = projects.filter((project) =>
    workspaceId ? project.workspaceId === workspaceId : true,
  );
  const activeCount =
    Number(value.onlyOverdue) +
    Number(value.onlyScheduled) +
    Number(value.onlyRecurring) +
    Number(value.onlyDated) +
    Number(value.showCompleted !== defaults.showCompleted) +
    (value.workspaceIds?.length ?? 0) +
    (value.statusKeys?.length ?? value.statusIds.length) +
    value.priorityLevels.length +
    value.labelIds.length +
    value.stageIds.length +
    (value.projectIds?.length ?? 0);

  function toggleStatusGroup(group: NamedStatusGroup) {
    const ids = group.statuses.map((status) => status.id);
    const allOn =
      (value.statusKeys ?? []).includes(group.key) ||
      (ids.length > 0 && ids.every((id) => value.statusIds.includes(id)));
    onChange({
      ...value,
      statusKeys: allOn
        ? (value.statusKeys ?? []).filter((key) => key !== group.key)
        : [...new Set([...(value.statusKeys ?? []), group.key])],
      statusIds: allOn
        ? value.statusIds.filter((id) => !ids.includes(id))
        : [...new Set([...value.statusIds, ...ids])],
    });
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={activeCount ? `Filters  ·  ${activeCount} active` : "Filters"}
      footer={
        <View style={styles.footer}>
          <AnimatedPressable onPress={() => onChange(defaults)} style={styles.reset}>
            <Text style={styles.resetText}>Reset</Text>
          </AnimatedPressable>
          <View style={{ flex: 1 }}>
            <PrimaryButton label="Done" onPress={onClose} />
          </View>
        </View>
      }
    >
      <View style={styles.block}>
        <SectionLabel>Quick filters</SectionLabel>
        <View style={styles.row}>
          <FilterChip
            label="Overdue"
            active={value.onlyOverdue}
            onPress={() => onChange({ ...value, onlyOverdue: !value.onlyOverdue })}
          />
          <FilterChip
            label="Scheduled"
            active={value.onlyScheduled}
            onPress={() => onChange({ ...value, onlyScheduled: !value.onlyScheduled })}
          />
          <FilterChip
            label="Recurring"
            active={value.onlyRecurring}
            onPress={() => onChange({ ...value, onlyRecurring: !value.onlyRecurring })}
          />
          <FilterChip
            label="Dated"
            active={value.onlyDated}
            onPress={() => onChange({ ...value, onlyDated: !value.onlyDated })}
          />
        </View>
        <AnimatedPressable
          accessibilityRole="switch"
          accessibilityState={{ checked: value.showCompleted }}
          onPress={() => onChange({ ...value, showCompleted: !value.showCompleted })}
          style={styles.toggleRow}
        >
          <View>
            <Text style={styles.toggleTitle}>Show completed tasks</Text>
            <Text style={styles.toggleHint}>Include finished work in this list</Text>
          </View>
          <View style={[styles.switchTrack, value.showCompleted && styles.switchTrackOn]}>
            <View style={[styles.switchThumb, value.showCompleted && styles.switchThumbOn]} />
          </View>
        </AnimatedPressable>
      </View>

      {workspaces.length > 0 ? (
        <View style={styles.block}>
          <SectionLabel>Workspace</SectionLabel>
          <Select
            value={workspaceId}
            onChange={(id) => {
              const nextProject =
                id && projectId && !projects.some((project) => project.id === projectId && project.workspaceId === id)
                  ? []
                  : value.projectIds ?? [];
              onChange({
                ...value,
                workspaceIds: id ? [id] : [],
                projectIds: nextProject,
              });
            }}
            placeholder="All spaces"
            options={[
              { value: "", label: "All spaces" },
              ...workspaces.map((space) => ({ value: space.id, label: space.name, color: space.color ?? undefined })),
            ]}
          />
        </View>
      ) : null}

      {scopedProjects.length > 0 ? (
        <View style={styles.block}>
          <SectionLabel>Project</SectionLabel>
          <Select
            value={projectId}
            onChange={(id) => onChange({ ...value, projectIds: id ? [id] : [] })}
            placeholder="All projects"
            options={[
              { value: "", label: "All projects" },
              ...scopedProjects.map((project) => ({
                value: project.id,
                label: project.title || "Untitled project",
                color: project.color ?? undefined,
              })),
            ]}
          />
        </View>
      ) : null}

      {statusGroups.length > 0 ? (
        <View style={styles.block}>
          <SectionLabel>Status</SectionLabel>
          <View style={styles.row}>
            {statusGroups.map((group) => (
              <FilterChip
                key={group.key}
                label={group.name}
                color={group.color}
                active={(value.statusKeys ?? []).includes(group.key) || group.statuses.some((status) => value.statusIds.includes(status.id))}
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
            <FilterChip
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
              <FilterChip
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
          <SectionLabel>Release stage</SectionLabel>
          <View style={styles.row}>
            {stages.map((stage) => (
              <FilterChip
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
  block: { gap: 10, marginBottom: 22 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: { flexDirection: "row", alignItems: "center", gap: 12 },
  reset: { paddingHorizontal: 12, paddingVertical: 12 },
  resetText: { color: colors.mutedForeground, fontWeight: "600" },
  chip: {
    minHeight: 42,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 15,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.ring, shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  chipText: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  toggleRow: { minHeight: 58, marginTop: 4, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  toggleTitle: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  toggleHint: { color: colors.mutedForeground, fontSize: 10, marginTop: 2 },
  switchTrack: { width: 42, height: 24, borderRadius: 12, padding: 3, backgroundColor: colors.muted },
  switchTrackOn: { backgroundColor: colors.primary },
  switchThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.foreground },
  switchThumbOn: { alignSelf: "flex-end" },
}));
