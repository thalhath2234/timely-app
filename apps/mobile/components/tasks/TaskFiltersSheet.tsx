import { useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Check, ChevronRight, CornerDownLeft, Plus, Sparkles, Trash2, X } from "lucide-react-native";
import { replaceRule } from "@timely/contract/ruleBuilder";
import { isRuleGroup, normalizeRules } from "@timely/contract/taskQuery";
import { aiDraftPatch, readingPatch, readViewQuery, ruleLabel, vocabularyFrom } from "@timely/contract/viewLanguage";
import { todayInZone } from "@timely/contract/workStatus";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import SegmentedControl from "../ui/SegmentedControl";
import { Button, Field, PrimaryButton, PropertyChip, PropertyChips, Select } from "../ui/primitives";
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

/** "Bug, Design" or "Bug, Design +2"; `none` when nothing is picked. */
function summary(names: string[], none: string) {
  if (names.length === 0) return none;
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/** A row of a settings card: muted label on the left, a control on the right. */
function ControlRow({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <View style={[styles.controlRow, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowControl}>{children}</View>
    </View>
  );
}

/** A row that opens a page of the sheet; the value sums up what is picked. */
function PageRow({
  label,
  value,
  active,
  swatch,
  onPress,
  last,
}: {
  label: string;
  value: string;
  active?: boolean;
  swatch?: string | null;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      android_ripple={{ color: `${colors.primary}22` }}
      style={[styles.controlRow, last && styles.rowLast]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueWrap}>
        {swatch ? <View style={[styles.chipDot, { backgroundColor: swatch }]} /> : null}
        <Text numberOfLines={1} style={[styles.rowValue, active && styles.rowValueOn]}>
          {value}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.mutedForeground} />
    </AnimatedPressable>
  );
}

function GroupHeading({ children, count }: { children: string; count?: number }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.headingText}>{children}</Text>
      {count ? <Text style={styles.headingCount}>{count}</Text> : null}
    </View>
  );
}

type Page = "group" | "sort" | "workspace" | "project" | "status" | "priority" | "labels" | "stages";

const LIMITS = [5, 10, 20];

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

  const [page, setPage] = useState<Page | null>(null);
  const sortName = (value?: string) => NATIVE_SORT_OPTIONS.find((option) => option.value === value)?.label ?? "Name";
  const arrow = (direction?: string) => (direction === "desc" ? "↓" : "↑");
  const sortSummary = `${sortName(view.sortBy)} ${arrow(view.sortDirection)}${
    view.thenSortBy ? `, then ${sortName(view.thenSortBy)} ${arrow(view.thenSortDirection)}` : ""
  }`;
  const workspace = workspaces.find((space) => space.id === workspaceId);
  const project = projects.find((item) => item.id === projectId);
  const activeStatusGroups = statusGroups.filter((group) => group.statuses.some((status) => statusIds.includes(status.id)));
  const priorities = view.selectedPriorityLevels ?? [];
  const labelIds = view.selectedLabelIds ?? [];
  const stageIds = view.selectedStageIds ?? [];
  const limitValue = view.limit ? String(view.limit) : "all";
  const limitOptions = [
    { value: "all", label: "All" },
    ...[...new Set([...LIMITS, ...(view.limit ? [view.limit] : [])])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: String(n) })),
  ];
  const showCompleted = view.showCompleted !== false;

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
      <View style={[styles.card, styles.nameCard]}>
        <Text style={styles.rowLabel}>Name</Text>
        <View style={{ flex: 1 }}>
          <Field bare value={view.name} onChangeText={(name) => onPatch({ name })} placeholder="View name" autoCapitalize="words" />
        </View>
        <AnimatedPressable accessibilityRole="button" onPress={onAdd} hitSlop={8} style={styles.textAction}>
          <Plus size={15} color={colors.primary} strokeWidth={2.5} />
          <Text style={styles.textActionLabel}>New view</Text>
        </AnimatedPressable>
      </View>

      <GroupHeading count={rules.length}>Filters</GroupHeading>
      <View style={styles.card}>
        <View style={styles.filtersPad}>
          <View style={styles.describeRow}>
            <View style={{ flex: 1 }}>
              <Field
                value={text}
                onChangeText={(next) => setWords({ viewId: view.id, text: next })}
                placeholder="Describe: urgent bugs due this week"
                autoCapitalize="sentences"
              />
            </View>
            <Button
              label="Apply"
              iconOnly
              variant={query ? "primary" : "secondary"}
              icon={<CornerDownLeft size={16} color={query ? colors.primaryForeground : colors.mutedForeground} />}
              onPress={describe}
              disabled={!query}
            />
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
                  hitSlop={6}
                  onPress={() => onPatch({ rules: replaceRule(rules, index, null) })}
                  style={styles.ruleRemove}
                >
                  <X size={16} color={colors.mutedForeground} />
                </AnimatedPressable>
              </View>
            );
          })}
        </View>
        <View style={[styles.controlRow, styles.rowLast]}>
          <AnimatedPressable accessibilityRole="button" onPress={() => setEditing({ index: null })} hitSlop={8} style={styles.textAction}>
            <Plus size={15} color={colors.primary} strokeWidth={2.5} />
            <Text style={styles.textActionLabel}>Add filter</Text>
          </AnimatedPressable>
          {rules.length > 1 ? (
            <View style={styles.rowControl}>
              <Text style={styles.matchLabel}>Match</Text>
              <SegmentedControl
                size="sm"
                accessibilityLabel="Which filters a task must pass"
                value={view.ruleMatch === "any" ? "any" : "all"}
                onChange={(next) => onPatch({ ruleMatch: next === "any" ? "any" : undefined })}
                options={[
                  { value: "all", label: "Every" },
                  { value: "any", label: "Any" },
                ]}
              />
            </View>
          ) : null}
        </View>
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

      <GroupHeading>Arrange</GroupHeading>
      <View style={styles.card}>
        <ControlRow label="Layout">
          <SegmentedControl
            size="sm"
            accessibilityLabel="Layout"
            value={renderMode}
            onChange={(next) =>
              onPatch({
                renderMode: next,
                groupFields: next === "kanban" && !BASE_GROUP_FIELDS.includes(view.groupFields?.[0] ?? "status") ? ["status"] : view.groupFields,
                dataMode: next === "kanban" ? "task" : view.dataMode,
                showReminders: next === "kanban" ? false : view.showReminders,
              })
            }
            options={NATIVE_RENDER_OPTIONS}
          />
        </ControlRow>
        <ControlRow label="Show">
          <SegmentedControl
            size="sm"
            accessibilityLabel="Show"
            value={dataValue}
            onChange={setData}
            options={[
              { value: "task", label: "Tasks" },
              { value: "reminder", label: "Reminders" },
              { value: "project", label: "Projects" },
            ]}
          />
        </ControlRow>
        <PageRow
          label="Group by"
          value={groupFields.length ? groupFields.map((field) => groupFieldLabel(field, customFields)).join(" › ") : "None"}
          onPress={() => setPage("group")}
        />
        <PageRow label="Sort" value={sortSummary} onPress={() => setPage("sort")} />
        <ControlRow label="Limit" last>
          <SegmentedControl
            size="sm"
            accessibilityLabel="How many to show"
            value={limitValue}
            onChange={(next) => onPatch({ limit: next === "all" ? undefined : Number(next) })}
            options={limitOptions}
          />
        </ControlRow>
      </View>

      <GroupHeading>Narrow down</GroupHeading>
      <View style={styles.card}>
        {workspaces.length > 0 ? (
          <PageRow
            label="Workspace"
            value={workspace?.name ?? "All spaces"}
            swatch={workspace?.color}
            active={Boolean(workspace)}
            onPress={() => setPage("workspace")}
          />
        ) : null}
        {scopedProjects.length > 0 ? (
          <PageRow
            label="Project"
            value={project ? project.title || "Untitled project" : "All projects"}
            swatch={project?.color}
            active={Boolean(project)}
            onPress={() => setPage("project")}
          />
        ) : null}
        {statusGroups.length > 0 ? (
          <PageRow
            label="Status"
            value={summary(activeStatusGroups.map((group) => group.name), "Any")}
            swatch={activeStatusGroups.length === 1 ? activeStatusGroups[0].color : undefined}
            active={activeStatusGroups.length > 0}
            onPress={() => setPage("status")}
          />
        ) : null}
        <PageRow
          label="Priority"
          value={summary(PRIORITIES.filter((level) => priorities.includes(level)), "Any")}
          active={priorities.length > 0}
          onPress={() => setPage("priority")}
        />
        {labels.length > 0 ? (
          <PageRow
            label="Labels"
            value={summary(labels.filter((label) => labelIds.includes(label.id)).map((label) => label.name), "Any")}
            active={labelIds.length > 0}
            onPress={() => setPage("labels")}
          />
        ) : null}
        {stages.length > 0 ? (
          <PageRow
            label="Release stage"
            value={summary(stages.filter((stage) => stageIds.includes(stage.id)).map((stage) => stage.name), "Any")}
            active={stageIds.length > 0}
            onPress={() => setPage("stages")}
          />
        ) : null}
        <View style={styles.quickPad}>
          <PropertyChips>
            {(
              [
                ["Overdue", "onlyOverdue"],
                ["Scheduled", "onlyScheduled"],
                ["Recurring", "onlyRecurring"],
                ["Dated", "onlyDated"],
              ] as const
            ).map(([label, key]) => (
              <PropertyChip
                key={key}
                label={label}
                active={Boolean(view[key])}
                icon={view[key] ? <Check size={14} color={colors.accentForeground} strokeWidth={2.5} /> : undefined}
                onPress={() => onPatch({ [key]: !view[key] })}
              />
            ))}
          </PropertyChips>
        </View>
        <AnimatedPressable
          accessibilityRole="switch"
          accessibilityLabel="Show completed tasks"
          accessibilityState={{ checked: showCompleted }}
          onPress={() => onPatch({ showCompleted: !showCompleted })}
          style={[styles.controlRow, styles.rowLast]}
        >
          <Text style={[styles.rowLabel, styles.rowLabelWide]}>Show completed tasks</Text>
          <View style={[styles.switchTrack, showCompleted && styles.switchTrackOn]}>
            <View style={[styles.switchThumb, showCompleted && styles.switchThumbOn]} />
          </View>
        </AnimatedPressable>
      </View>

      {canDelete ? (
        <AnimatedPressable accessibilityRole="button" onPress={onDelete} style={[styles.card, styles.deleteRow]}>
          <Trash2 size={16} color={colors.destructive} />
          <Text style={styles.deleteText}>Delete view</Text>
        </AnimatedPressable>
      ) : null}

      <BottomSheet open={page === "group"} onClose={() => setPage(null)} title="Group by">
        <View style={styles.pageStack}>
          {groupFields.map((field, index) => (
            <View key={`${field}-${index}`} style={styles.groupRow}>
              <Text style={styles.groupIndex}>{index + 1}</Text>
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
              <Button
                label={`Stop grouping by ${groupFieldLabel(field, customFields)}`}
                iconOnly
                variant="ghost"
                icon={<X size={16} color={colors.mutedForeground} />}
                onPress={() => updateGroupField(index, "")}
              />
            </View>
          ))}
          {groupFields.length < 3 ? (
            <AnimatedPressable accessibilityRole="button" onPress={addGroupField} hitSlop={8} style={[styles.textAction, styles.pageAction]}>
              <Plus size={15} color={colors.primary} strokeWidth={2.5} />
              <Text style={styles.textActionLabel}>{groupFields.length ? "Add a level" : "Add a group"}</Text>
            </AnimatedPressable>
          ) : null}
          {groupFields.length > 0 ? (
            <View style={[styles.card, styles.pageCard]}>
              <ControlRow label="Group order" last>
                <SegmentedControl
                  size="sm"
                  accessibilityLabel="Group order"
                  value={view.groupSortDirection === "desc" ? "desc" : "asc"}
                  onChange={(next) => onPatch({ groupSortDirection: next })}
                  options={[
                    { value: "asc", label: "A–Z" },
                    { value: "desc", label: "Z–A" },
                  ]}
                />
              </ControlRow>
            </View>
          ) : null}
        </View>
      </BottomSheet>

      <BottomSheet open={page === "sort"} onClose={() => setPage(null)} title="Sort">
        <View style={styles.pageStack}>
          <Select
            label="Sort by"
            value={view.sortBy}
            onChange={(next) => onPatch({ sortBy: next as TaskViewSortBy })}
            placeholder="Sort by"
            options={NATIVE_SORT_OPTIONS}
          />
          <SegmentedControl
            accessibilityLabel="Sort direction"
            value={view.sortDirection === "desc" ? "desc" : "asc"}
            onChange={(next) => onPatch({ sortDirection: next })}
            options={[
              { value: "asc", label: "Ascending" },
              { value: "desc", label: "Descending" },
            ]}
          />
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
            <SegmentedControl
              accessibilityLabel="Then by direction"
              value={view.thenSortDirection === "desc" ? "desc" : "asc"}
              onChange={(next) => onPatch({ thenSortDirection: next })}
              options={[
                { value: "asc", label: "Ascending" },
                { value: "desc", label: "Descending" },
              ]}
            />
          ) : null}
        </View>
      </BottomSheet>

      <BottomSheet open={page === "workspace"} onClose={() => setPage(null)} title="Workspace">
        {[{ id: "", name: "All spaces", color: null as string | null | undefined }, ...workspaces].map((space) => (
          <SheetOption
            key={space.id || "__all"}
            selected={space.id === workspaceId}
            leading={space.color ? <View style={[styles.chipDot, { backgroundColor: space.color }]} /> : undefined}
            onSelect={() => {
              const id = space.id;
              const nextProject =
                id && projectId && !projects.some((item) => item.id === projectId && item.workspaceId === id)
                  ? []
                  : view.selectedProjectIds ?? [];
              onPatch({ selectedWorkspaceIds: id ? [id] : [], selectedProjectIds: nextProject });
              setPage(null);
            }}
          >
            {space.name}
          </SheetOption>
        ))}
      </BottomSheet>

      <BottomSheet open={page === "project"} onClose={() => setPage(null)} title="Project">
        {[{ id: "", title: "All projects", color: null as string | null | undefined }, ...scopedProjects].map((item) => (
          <SheetOption
            key={item.id || "__all"}
            selected={item.id === projectId}
            leading={item.color ? <View style={[styles.chipDot, { backgroundColor: item.color }]} /> : undefined}
            onSelect={() => {
              onPatch({ selectedProjectIds: item.id ? [item.id] : [] });
              setPage(null);
            }}
          >
            {item.title || "Untitled project"}
          </SheetOption>
        ))}
      </BottomSheet>

      <BottomSheet open={page === "status"} onClose={() => setPage(null)} title="Status" subtitle="Show tasks in any of these">
        {statusGroups.map((group) => (
          <SheetOption
            key={group.key}
            selected={activeStatusGroups.includes(group)}
            leading={<View style={[styles.chipDot, { backgroundColor: group.color }]} />}
            onSelect={() => toggleStatusGroup(group)}
          >
            {group.name}
          </SheetOption>
        ))}
      </BottomSheet>

      <BottomSheet open={page === "priority"} onClose={() => setPage(null)} title="Priority" subtitle="Show tasks with any of these">
        {PRIORITIES.map((level) => (
          <SheetOption
            key={level}
            selected={priorities.includes(level)}
            onSelect={() => onPatch({ selectedPriorityLevels: toggleId(priorities, level) })}
          >
            {level}
          </SheetOption>
        ))}
      </BottomSheet>

      <BottomSheet open={page === "labels"} onClose={() => setPage(null)} title="Labels" subtitle="Show tasks with any of these">
        {labels.map((label) => (
          <SheetOption
            key={label.id}
            selected={labelIds.includes(label.id)}
            leading={<View style={[styles.chipDot, { backgroundColor: label.color || colors.mutedForeground }]} />}
            onSelect={() => onPatch({ selectedLabelIds: toggleId(labelIds, label.id) })}
          >
            {label.name}
          </SheetOption>
        ))}
      </BottomSheet>

      <BottomSheet open={page === "stages"} onClose={() => setPage(null)} title="Release stage" subtitle="Show tasks in any of these">
        {stages.map((stage) => (
          <SheetOption
            key={stage.id}
            selected={stageIds.includes(stage.id)}
            onSelect={() => onPatch({ selectedStageIds: toggleId(stageIds, stage.id) })}
          >
            {stage.name}
          </SheetOption>
        ))}
      </BottomSheet>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  // Cards of rows, like the phone settings screens (docs/design-system.md):
  // 16px between cards, a 13px heading 6px above its card.
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
    marginBottom: 16,
  },
  pageCard: { marginBottom: 0 },
  nameCard: { flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, paddingRight: 12, minHeight: 52 },
  heading: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginHorizontal: 4, marginBottom: 6 },
  headingText: { color: colors.mutedForeground, fontSize: 13, fontWeight: "600" },
  headingCount: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  controlRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { flexShrink: 0, color: colors.foreground, fontSize: 14, fontWeight: "500" },
  rowLabelWide: { flex: 1 },
  rowControl: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  rowValueWrap: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  rowValue: { flexShrink: 1, color: colors.mutedForeground, fontSize: 14, textAlign: "right" },
  rowValueOn: { color: colors.foreground, fontWeight: "500" },
  matchLabel: { color: colors.mutedForeground, fontSize: 12.5 },
  textAction: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  textActionLabel: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  pageAction: { alignSelf: "flex-start" },
  filtersPad: { padding: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  footer: { flexDirection: "row", alignItems: "center", gap: 12 },
  reset: { paddingHorizontal: 12, paddingVertical: 12 },
  resetText: { color: colors.primary, fontWeight: "600" },
  error: { color: colors.destructive, fontSize: 12 },
  describeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ruleRow: { minHeight: 42, borderRadius: 10, backgroundColor: colors.muted, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 4 },
  ruleBody: { flex: 1, minHeight: 42, justifyContent: "center", paddingVertical: 6 },
  ruleText: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  ruleRemove: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  quickPad: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  deleteRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 48 },
  deleteText: { color: colors.destructive, fontSize: 14, fontWeight: "600" },
  pageStack: { gap: 12 },
  groupRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  groupIndex: { width: 16, color: colors.mutedForeground, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  // Off: border track, muted thumb, so it reads on a card in both themes.
  switchTrack: { width: 40, height: 24, borderRadius: 12, padding: 3, backgroundColor: colors.border },
  switchTrackOn: { backgroundColor: colors.primary },
  switchThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.mutedForeground },
  switchThumbOn: { alignSelf: "flex-end", backgroundColor: colors.primaryForeground },
}));
