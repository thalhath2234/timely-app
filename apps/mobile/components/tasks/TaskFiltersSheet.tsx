import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Check, ListFilter, Sparkles, X } from "lucide-react-native";
import { replaceRule } from "@timely/contract/ruleBuilder";
import { isRuleGroup, normalizeRules } from "@timely/contract/taskQuery";
import { aiDraftPatch, readingPatch, readViewQuery, ruleLabel, vocabularyFrom } from "@timely/contract/viewLanguage";
import { todayInZone } from "@timely/contract/workStatus";
import BottomSheet from "../ui/BottomSheet";
import SegmentedControl from "../ui/SegmentedControl";
import { Button, Field, PrimaryButton, SectionLabel, Select } from "../ui/primitives";
import RuleEditorSheet from "./RuleEditorSheet";
import { readyProviders } from "../chat/ModelSheet";
import { readViewWithAi } from "../../lib/api/viewQuery";
import { useAgentProvidersQuery, useWorkingHoursZone } from "../../lib/hooks";
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
  TaskViewSortBy,
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
  const border = color ? (active ? `${color}88` : "transparent") : undefined;
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      hitSlop={8}
      onPress={onPress}
      style={[
        styles.chip,
        active && !color ? styles.chipOn : null,
        color ? { borderColor: border, backgroundColor: tint || colors.muted } : null,
      ]}
    >
      {active ? <Check size={15} color={color || colors.primaryForeground} strokeWidth={2.5} /> : null}
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
// Grouped into buckets (Overdue, Today, This week, ...) by the shared engine;
// the list only, the board keeps one column per value it can move cards to.
const BUCKET_GROUP_FIELDS: TaskListGroupField[] = [
  "label",
  "deadline",
  "planned",
  "startDate",
  "createdAt",
  "updatedAt",
  "completedAt",
  "effort",
  "done",
  "recurring",
];

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
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [words, setWords] = useState({ viewId: "", text: "" });
  const [leftover, setLeftover] = useState<{ text: string; words: string[] } | null>(null);
  const [ai, setAi] = useState<{ text: string; busy?: boolean; error?: string; done?: boolean } | null>(null);
  const providers = useAgentProvidersQuery().data;
  const aiReady = readyProviders(providers).length > 0;
  const timeZone = useWorkingHoursZone();
  const vocab = useMemo(() => vocabularyFrom({ workspaces, projects, customFields }), [workspaces, projects, customFields]);
  const rules = normalizeRules(view.rules);
  const text = words.viewId === view.id ? words.text : "";
  const query = text.trim();
  const pendingWords = leftover && leftover.text === query ? leftover.words : [];
  const aiState = ai?.text === query ? ai : null;
  const editingRule = editing?.index != null ? rules[editing.index] : null;

  function describe() {
    if (!query) return;
    const reading = readViewQuery(query, vocab, { today: todayInZone(timeZone) });
    if (reading.understood === 0 && reading.leftover.length === 0) return;
    onPatch({ ...readingPatch(reading), prompt: query.slice(0, 300) });
    setLeftover({ text: query, words: reading.leftover });
    setAi(null);
  }

  function askAi() {
    setAi({ text: query, busy: true });
    readViewWithAi({ query, today: todayInZone(timeZone), client: "phone" })
      .then((result) => {
        onPatch({ ...aiDraftPatch(result.view, vocab), prompt: query.slice(0, 300) });
        setAi({ text: query, done: true });
        setLeftover(null);
      })
      .catch((error: Error) => setAi({ text: query, error: error.message }));
  }

  const workspaceId = view.selectedWorkspaceIds?.[0] ?? "";
  const projectId = view.selectedProjectIds?.[0] ?? "";
  const scopedProjects = projects.filter((project) =>
    workspaceId ? project.workspaceId === workspaceId : true,
  );
  const groupFields = (view.groupFields ?? []).slice(0, 3);
  const availableGroups: TaskListGroupField[] = [
    ...BASE_GROUP_FIELDS,
    ...(view.renderMode === "kanban" ? [] : BUCKET_GROUP_FIELDS),
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
        <SectionLabel action={rules.length ? <Text style={styles.hint}>{rules.length}</Text> : undefined}>Filters</SectionLabel>
        <View style={styles.describeRow}>
          <View style={{ flex: 1 }}>
            <Field
              value={text}
              onChangeText={(next) => setWords({ viewId: view.id, text: next })}
              placeholder="Describe: urgent bugs due this week"
              autoCapitalize="sentences"
            />
          </View>
          <Button label="Apply" variant="secondary" icon={<ListFilter size={16} color={colors.foreground} />} onPress={describe} disabled={!query} />
        </View>
        {aiReady && query && (pendingWords.length > 0 || aiState) && !aiState?.done ? (
          <Button
            label={aiState?.busy ? "Reading…" : "Read with AI"}
            variant="ghost"
            size="sm"
            icon={<Sparkles size={16} color={colors.mutedForeground} />}
            loading={aiState?.busy}
            onPress={askAi}
          />
        ) : null}
        {aiState?.error ? <Text style={styles.error}>{aiState.error}</Text> : null}
        {rules.map((rule, index) => {
          const { label } = ruleLabel(rule, vocab);
          const group = isRuleGroup(rule);
          return (
            <View key={`${index}-${label}`} style={styles.ruleRow}>
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel={group ? label : `Edit filter: ${label}`}
                disabled={group}
                onPress={() => setEditing({ index })}
                style={styles.ruleBody}
              >
                <Text numberOfLines={2} style={styles.ruleText}>{label}</Text>
              </AnimatedPressable>
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel={`Remove filter: ${label}`}
                hitSlop={8}
                onPress={() => onPatch({ rules: replaceRule(rules, index, null) })}
                style={styles.ruleRemove}
              >
                <X size={16} color={colors.mutedForeground} />
              </AnimatedPressable>
            </View>
          );
        })}
        <View style={styles.row}>
          <FilterChip label="Add filter" onPress={() => setEditing({ index: null })} />
        </View>
        {rules.length > 1 ? (
          <View style={styles.block}>
            <Text style={styles.toggleHint}>A task must pass</Text>
            <SegmentedControl
              value={view.ruleMatch === "any" ? "any" : "all"}
              onChange={(next) => onPatch({ ruleMatch: next === "any" ? "any" : undefined })}
              options={[
                { value: "all", label: "Every filter" },
                { value: "any", label: "Any filter" },
              ]}
            />
          </View>
        ) : null}
        <RuleEditorSheet
          open={editing !== null}
          rule={editingRule && !isRuleGroup(editingRule) ? editingRule : null}
          vocab={vocab}
          customFields={customFields}
          onChange={(rule) => {
            if (editing?.index == null) {
              onPatch({ rules: [...rules, rule] });
              setEditing({ index: rules.length });
              return;
            }
            onPatch({ rules: replaceRule(rules, editing.index, rule) });
          }}
          onRemove={() => {
            if (editing?.index != null) onPatch({ rules: replaceRule(rules, editing.index, null) });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      </View>

      <View style={styles.block}>
        <SectionLabel>Layout</SectionLabel>
        <View style={styles.row}>
          {NATIVE_RENDER_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              active={renderMode === option.value}
              onPress={() => onPatch({ renderMode: option.value, groupFields: option.value === "kanban" && !BASE_GROUP_FIELDS.includes(view.groupFields?.[0] ?? "status") ? ["status"] : view.groupFields, dataMode: option.value === "kanban" ? "task" : view.dataMode, showReminders: option.value === "kanban" ? false : view.showReminders })}
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
          onChange={(next) => onPatch({ sortBy: next as TaskViewSortBy })}
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
        <Select
          label="Then by"
          value={view.thenSortBy ?? ""}
          onChange={(next) =>
            onPatch(
              next
                ? { thenSortBy: next as TaskViewSortBy, thenSortDirection: view.thenSortDirection ?? "asc" }
                : { thenSortBy: undefined, thenSortDirection: undefined },
            )
          }
          placeholder="Nothing"
          options={[{ value: "", label: "Nothing" }, ...NATIVE_SORT_OPTIONS.filter((option) => option.value !== view.sortBy)]}
        />
        {view.thenSortBy ? (
          <View style={styles.row}>
            <FilterChip
              label="Ascending"
              active={view.thenSortDirection !== "desc"}
              onPress={() => onPatch({ thenSortDirection: "asc" })}
            />
            <FilterChip
              label="Descending"
              active={view.thenSortDirection === "desc"}
              onPress={() => onPatch({ thenSortDirection: "desc" })}
            />
          </View>
        ) : null}
      </View>

      <View style={styles.block}>
        <SectionLabel>Show</SectionLabel>
        <View style={styles.row}>
          <FilterChip label="All" active={!view.limit} onPress={() => onPatch({ limit: undefined })} />
          <FilterChip label="First 5" active={view.limit === 5} onPress={() => onPatch({ limit: 5 })} />
          <FilterChip label="First 10" active={view.limit === 10} onPress={() => onPatch({ limit: 10 })} />
          <FilterChip label="First 20" active={view.limit === 20} onPress={() => onPatch({ limit: 20 })} />
        </View>
        {view.limit && ![5, 10, 20].includes(view.limit) ? <Text style={styles.toggleHint}>Showing the first {view.limit}</Text> : null}
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
  block: { gap: 12, marginBottom: 24 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  groupRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  footer: { flexDirection: "row", alignItems: "center", gap: 12 },
  reset: { paddingHorizontal: 12, paddingVertical: 12 },
  resetText: { color: colors.primary, fontWeight: "600" },
  hint: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  error: { color: colors.destructive, fontSize: 12 },
  describeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ruleRow: { minHeight: 48, borderRadius: 16, backgroundColor: colors.muted, flexDirection: "row", alignItems: "center", paddingLeft: 14, paddingRight: 6 },
  ruleBody: { flex: 1, minHeight: 48, justifyContent: "center", paddingVertical: 8 },
  ruleText: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  ruleRemove: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  remove: { paddingHorizontal: 8, paddingVertical: 10 },
  removeText: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  chip: {
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: colors.muted,
    paddingHorizontal: 15,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipOn: { backgroundColor: colors.primary },
  chipText: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  toggleRow: { minHeight: 64, marginTop: 4, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.muted, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  toggleTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  toggleHint: { color: colors.mutedForeground, fontSize: 11, marginTop: 2 },
  switchTrack: { width: 42, height: 24, borderRadius: 12, padding: 3, backgroundColor: colors.muted },
  switchTrackOn: { backgroundColor: colors.primary },
  switchThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.foreground },
  switchThumbOn: { alignSelf: "flex-end" },
}));
