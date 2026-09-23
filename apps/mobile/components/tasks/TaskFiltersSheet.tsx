import { Text, View } from "react-native";
import BottomSheet from "../ui/BottomSheet";
import { Field, PrimaryButton, SectionLabel, Select } from "../ui/primitives";
import AnimatedPressable from "../ui/AnimatedPressable";
import { PRIORITIES } from "../../lib/priority";
import {
  groupFieldLabel,
  NATIVE_RENDER_OPTIONS,
  NATIVE_SORT_OPTIONS,
  NATIVE_VIEW_TEMPLATE,
} from "../../lib/nativeTaskViews";
import type { NamedStatusGroup } from "../../lib/status";
import type {
  CustomField,
  Label,
  Project,
  Stage,
  TaskListDataMode,
  TaskListGroupField,
  TaskListSortBy,
  TaskRenderMode,
  TaskViewConfig,
  Workspace,
} from "../../lib/types";
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

const BASE_GROUP_FIELDS: TaskListGroupField[] = ["workspace", "project", "stage", "status", "priority"];

export default function TaskFiltersSheet({
  open,
  onClose,
  view,
  onPatch,
  onAdd,
  onDelete,
  canDelete,
  customFields = [],
  statusGroups,
  labels,
  stages,
  workspaces = [],
  projects = [],
}: {
  open: boolean;
  onClose: () => void;
  view: TaskViewConfig;
  onPatch: (patch: Partial<TaskViewConfig>) => void;
  onAdd: () => void;
  onDelete: () => void;
  canDelete: boolean;
  customFields?: CustomField[];
  statusGroups: NamedStatusGroup[];
  labels: Label[];
  stages: Stage[];
  workspaces?: Workspace[];
  projects?: Project[];
}) {
  const workspaceId = view.selectedWorkspaceIds?.[0] ?? "";
  const projectId = view.selectedProjectIds?.[0] ?? "";
  const scopedProjects = projects.filter((project) =>
    workspaceId ? project.workspaceId === workspaceId : true,
  );
  const groupFields = (view.groupFields ?? []).slice(0, 3);
  const availableGroups: TaskListGroupField[] = [
    ...BASE_GROUP_FIELDS,
    ...(view.renderMode === "kanban" ? [] : customFields.map((field) => `cf:${field.id}` as TaskListGroupField)),
  ];
  const dataValue = view.showReminders ? "reminder" : view.dataMode === "project" ? "project" : "task";
  const renderMode: TaskRenderMode = view.renderMode === "kanban" ? "kanban" : "list";
  const statusIds = view.selectedStatusIds ?? [];
  const statusKeys = statusIds.length
    ? statusGroups.filter((group) => group.statuses.some((status) => statusIds.includes(status.id))).map((group) => group.key)
    : [];

  function setData(next: string) {
    if (next === "reminder") {
      onPatch({ showReminders: true, dataMode: "task", renderMode: "list" });
      return;
    }
    if (next === "project") {
      onPatch({ showReminders: false, dataMode: "project", renderMode: "list" });
      return;
    }
    onPatch({ showReminders: false, dataMode: "task" as TaskListDataMode });
  }

  function updateGroupField(index: number, value: string) {
    const next = [...groupFields];
    if (!value) {
      next.splice(index, 1);
    } else {
      next[index] = value as TaskListGroupField;
    }
    onPatch({ groupFields: next.filter(Boolean).slice(0, 3) });
  }

  function addGroupField() {
    const next = availableGroups.find((field) => !groupFields.includes(field));
    if (!next || groupFields.length >= 3) return;
    onPatch({ groupFields: [...groupFields, next] });
  }

  function toggleStatusGroup(group: NamedStatusGroup) {
    const ids = group.statuses.map((status) => status.id);
    const allOn = ids.length > 0 && ids.every((id) => statusIds.includes(id));
    onPatch({
      selectedStatusIds: allOn
        ? statusIds.filter((id) => !ids.includes(id))
        : [...new Set([...statusIds, ...ids])],
    });
  }

  function resetView() {
    onPatch({ ...NATIVE_VIEW_TEMPLATE });
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Customize view"
      footer={
        <View style={styles.footer}>
          <AnimatedPressable onPress={resetView} style={styles.reset}>
            <Text style={styles.resetText}>Reset</Text>
          </AnimatedPressable>
          <View style={{ flex: 1 }}>
            <PrimaryButton label="Done" onPress={onClose} />
          </View>
        </View>
      }
    >
      <View style={styles.block}>
        <SectionLabel>Name</SectionLabel>
        <Field value={view.name} onChangeText={(name) => onPatch({ name })} placeholder="View name" autoCapitalize="words" />
        <View style={styles.row}>
          <FilterChip label="Add view" onPress={onAdd} />
          {canDelete ? <FilterChip label="Delete view" onPress={onDelete} /> : null}
        </View>
      </View>

      <View style={styles.block}>
        <SectionLabel>Layout</SectionLabel>
        <View style={styles.row}>
          {NATIVE_RENDER_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              active={renderMode === option.value}
              onPress={() => onPatch({ renderMode: option.value, groupFields: option.value === "kanban" && view.groupFields?.[0]?.startsWith("cf:") ? ["status"] : view.groupFields, dataMode: option.value === "kanban" ? "task" : view.dataMode, showReminders: option.value === "kanban" ? false : view.showReminders })}
            />
          ))}
        </View>
      </View>

      <View style={styles.block}>
        <SectionLabel>Show</SectionLabel>
        <View style={styles.row}>
          <FilterChip label="Tasks" active={dataValue === "task"} onPress={() => setData("task")} />
          <FilterChip label="Reminders" active={dataValue === "reminder"} onPress={() => setData("reminder")} />
          <FilterChip label="Projects" active={dataValue === "project"} onPress={() => setData("project")} />
        </View>
      </View>

      <View style={styles.block}>
        <SectionLabel action={<Text style={styles.hint}>{groupFields.length}/3</Text>}>Group by</SectionLabel>
        {groupFields.map((field, index) => (
          <View key={`${field}-${index}`} style={styles.groupRow}>
            <View style={{ flex: 1 }}>
              <Select
                value={field}
                onChange={(next) => updateGroupField(index, next)}
                placeholder="Group field"
                options={availableGroups
                  .filter((option) => option === field || !groupFields.includes(option))
                  .map((option) => ({ value: option, label: groupFieldLabel(option, customFields) }))}
              />
            </View>
            <AnimatedPressable onPress={() => updateGroupField(index, "")} style={styles.remove}>
              <Text style={styles.removeText}>Remove</Text>
            </AnimatedPressable>
          </View>
        ))}
        <View style={styles.row}>
          <FilterChip label="Add group" active={false} onPress={addGroupField} />
          <FilterChip
            label={view.groupSortDirection === "desc" ? "Groups Z–A" : "Groups A–Z"}
            active={view.groupSortDirection === "desc"}
            onPress={() => onPatch({ groupSortDirection: view.groupSortDirection === "asc" ? "desc" : "asc" })}
          />
        </View>
      </View>

      <View style={styles.block}>
        <SectionLabel>Sort</SectionLabel>
        <Select
          value={view.sortBy}
          onChange={(next) => onPatch({ sortBy: next as TaskListSortBy })}
          placeholder="Sort by"
          options={NATIVE_SORT_OPTIONS}
        />
        <View style={styles.row}>
          <FilterChip
            label="Ascending"
            active={view.sortDirection !== "desc"}
            onPress={() => onPatch({ sortDirection: "asc" })}
          />
          <FilterChip
            label="Descending"
            active={view.sortDirection === "desc"}
            onPress={() => onPatch({ sortDirection: "desc" })}
          />
        </View>
      </View>

      <View style={styles.block}>
        <SectionLabel>Quick filters</SectionLabel>
        <View style={styles.row}>
          <FilterChip
            label="Overdue"
            active={Boolean(view.onlyOverdue)}
            onPress={() => onPatch({ onlyOverdue: !view.onlyOverdue })}
          />
          <FilterChip
            label="Scheduled"
            active={Boolean(view.onlyScheduled)}
            onPress={() => onPatch({ onlyScheduled: !view.onlyScheduled })}
          />
          <FilterChip
            label="Recurring"
            active={Boolean(view.onlyRecurring)}
            onPress={() => onPatch({ onlyRecurring: !view.onlyRecurring })}
          />
          <FilterChip
            label="Dated"
            active={Boolean(view.onlyDated)}
            onPress={() => onPatch({ onlyDated: !view.onlyDated })}
          />
        </View>
        <AnimatedPressable
          accessibilityRole="switch"
          accessibilityState={{ checked: view.showCompleted !== false }}
          onPress={() => onPatch({ showCompleted: view.showCompleted === false })}
          style={styles.toggleRow}
        >
          <View>
            <Text style={styles.toggleTitle}>Show completed tasks</Text>
            <Text style={styles.toggleHint}>Include finished work in this view</Text>
          </View>
          <View style={[styles.switchTrack, view.showCompleted !== false && styles.switchTrackOn]}>
            <View style={[styles.switchThumb, view.showCompleted !== false && styles.switchThumbOn]} />
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
                  : view.selectedProjectIds ?? [];
              onPatch({
                selectedWorkspaceIds: id ? [id] : [],
                selectedProjectIds: nextProject,
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
            onChange={(id) => onPatch({ selectedProjectIds: id ? [id] : [] })}
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
                active={statusKeys.includes(group.key) || group.statuses.some((status) => statusIds.includes(status.id))}
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
              active={(view.selectedPriorityLevels ?? []).includes(level)}
              onPress={() => onPatch({ selectedPriorityLevels: toggleId(view.selectedPriorityLevels ?? [], level) })}
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
                active={(view.selectedLabelIds ?? []).includes(label.id)}
                onPress={() => onPatch({ selectedLabelIds: toggleId(view.selectedLabelIds ?? [], label.id) })}
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
                active={(view.selectedStageIds ?? []).includes(stage.id)}
                onPress={() => onPatch({ selectedStageIds: toggleId(view.selectedStageIds ?? [], stage.id) })}
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
  groupRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  footer: { flexDirection: "row", alignItems: "center", gap: 12 },
  reset: { paddingHorizontal: 12, paddingVertical: 12 },
  resetText: { color: colors.mutedForeground, fontWeight: "600" },
  hint: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  remove: { paddingHorizontal: 8, paddingVertical: 10 },
  removeText: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
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
