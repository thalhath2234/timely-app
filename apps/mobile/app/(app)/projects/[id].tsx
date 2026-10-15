import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Columns3,
  Copy,
  Flag,
  FolderKanban,
  ListTodo,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import BottomSheet, { SheetOption } from "../../../components/ui/BottomSheet";
import { projectDeleteCopy } from "@timely/contract/projectDelete";
import ConfirmSheet, { type ConfirmRequest } from "../../../components/ui/ConfirmSheet";
import DateTimeSheet from "../../../components/ui/DateTimeSheet";
import { Button, Field, PrimaryButton, PropertyGroup, PropertyRow, SectionLabel } from "../../../components/ui/primitives";
import { ColorDot, GroupLabel, ListGroup, ListRow } from "../../../components/settings/SettingsList";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import ColourSheet from "../../../components/ui/ColourSheet";
import {
  useCreateStage,
  useCreateTask,
  useDeleteProject,
  useDeleteStage,
  useDuplicateProject,
  useProjectActivityQuery,
  useProjectQuery,
  useProjectsQuery,
  useReorderStages,
  useSaveTask,
  useTasksQuery,
  useUpdateProject,
  useUpdateStage,
  useWorkspacesQuery,
} from "../../../lib/hooks";
import { PRIORITIES, normalizePriority } from "../../../lib/priority";
import { showUndoToast } from "../../../lib/toast";
import { formatShortDate, timeAgo, toDateInputValue } from "../../../lib/format";
import { colorName, resolvedColor, stableColorForId } from "../../../lib/entityColor";
import { colors, createThemedStyleSheet } from "../../../lib/theme";
import { useDraftText } from "../../../lib/draftText";
import { useAutosave } from "../../../lib/autosave";
import type { UpdateProjectPayload } from "../../../lib/api/projects";
import { requestQuickAdd } from "../../../lib/quickAddIntent";
import DescriptionCard from "../../../components/editor/DescriptionCard";
import RelatedList from "../../../components/search/RelatedList";
import ProjectInsightsCard from "../../../components/projects/ProjectInsightsCard";
import { isRichContentEmpty, toRichContent } from "../../../lib/richText";
import type { DocContent, Stage, Task } from "../../../lib/types";
import { FocusGroup, FocusGroupScrollView } from "../../../components/ui/FocusGroup";

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const projectQ = useProjectQuery(id);
  const listProject = (useProjectsQuery().data ?? []).find((item) => item.id === id);
  const liveProject = projectQ.data ?? listProject;
  const lastProject = useRef(liveProject);
  if (liveProject) lastProject.current = liveProject;
  const project = liveProject ?? lastProject.current;
  const tasks = useTasksQuery().data ?? [];
  const spaces = useWorkspacesQuery().data ?? [];
  const save = useUpdateProject();
  const { schedule: scheduleSave, flush: flushSave } = useAutosave<UpdateProjectPayload>(async (data) => {
    if (!id) return;
    await save.mutateAsync({ id, data });
  });
  const remove = useDeleteProject();
  const duplicate = useDuplicateProject();
  const addStage = useCreateStage();
  const renameStage = useUpdateStage();
  const deleteStage = useDeleteStage();
  const reorder = useReorderStages();
  const saveTask = useSaveTask();
  const createTask = useCreateTask();
  const activity = useProjectActivityQuery(id);
  const [taskTitle, setTaskTitle] = useState("");
  const [picker, setPicker] = useState<"status" | "priority" | "start" | "deadline" | "color" | "settings" | null>(null);
  const [editingStage, setEditingStage] = useState<Stage | "new" | null>(null);
  const [stageDraft, setStageDraft] = useState("");
  const [movingTask, setMovingTask] = useState<Task | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [assistantSelection, setAssistantSelection] = useState("");
  const [note, setNote] = useState("");
  const [noteRich, setNoteRich] = useState<DocContent>({ type: "doc", content: [{ type: "paragraph" }] });
  const [noteSync, setNoteSync] = useState(0);
  const seededNoteId = useRef<string | null>(null);
  const [title, setTitle] = useDraftText(project?.title, id);

  useAssistantScreen(project ? [
    contextChip("object", title || "Project", `projects/${project.id}`),
    ...(assistantSelection ? [contextChip("selection", "Selected text", assistantSelection)] : []),
    contextChip("workspace", "Workspace", project.workspaceId),
    ...(title !== project.title || note !== (project.description || "") ? [contextChip("draft", "Unsaved project text", { title, description: note })] : []),
  ] : []);

  const workspace = spaces.find((space) => space.id === project?.workspaceId);
  const projectTasks = useMemo(
    () => tasks.filter((task) => task.projectId === id),
    [tasks, id],
  );
  const stages = [...(project?.stages ?? [])].sort((a, b) => a.order - b.order);
  const board = useMemo(() => {
    const byStage = new Map<string, Task[]>();
    const unstaged: Task[] = [];
    for (const task of projectTasks) {
      if (task.stageId && stages.some((stage) => stage.id === task.stageId)) {
        const existing = byStage.get(task.stageId) ?? [];
        existing.push(task);
        byStage.set(task.stageId, existing);
      } else {
        unstaged.push(task);
      }
    }
    return [
      { id: "", name: "Unstaged", tasks: unstaged },
      ...stages.map((stage) => ({ id: stage.id, name: stage.name, tasks: byStage.get(stage.id) ?? [] })),
    ];
  }, [projectTasks, stages]);

  useEffect(() => {
    if (!project || seededNoteId.current === project.id) return;
    seededNoteId.current = project.id;
    const seed = !isRichContentEmpty(project.descriptionRich)
      ? project.descriptionRich
      : toRichContent(undefined, project.description || "");
    setNoteRich(seed ?? { type: "doc", content: [{ type: "paragraph" }] });
    setNote(project.description ?? "");
    setNoteSync((value) => value + 1);
  }, [project]);

  if (!project) {
    return (
      <Screen>
        <MobileHeader title="Project" back large={false} />
        <EmptyState
          icon={FolderKanban}
          title={projectQ.isLoading ? "Opening project" : "Project not found"}
          description={projectQ.isLoading ? "Fetching the latest details…" : "It may have been deleted."}
        />
      </Screen>
    );
  }

  const current = project;
  const accent = resolvedColor(current.color, current.id);

  function persist(data: Parameters<typeof save.mutate>[0]["data"]) {
    save.mutate({ id: current.id, data });
  }

  function moveStage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const ids = stages.map((stage) => stage.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved);
    reorder.mutate({ projectId: current.id, ids });
  }

  function assignStage(task: Task, stageId: string | null) {
    const previous = task.stageId ?? null;
    saveTask.mutate({ id: task.id, data: { stageId } });
    showUndoToast("Stage updated", () => saveTask.mutate({ id: task.id, data: { stageId: previous } }));
    setMovingTask(null);
  }

  const statusRecord = project.status ?? workspace?.status?.find((status) => status.id === project.statusId);
  const priority = normalizePriority(project.priorityLevel);
  const stageDraftTrimmed = stageDraft.trim();
  const editingStageItem = editingStage && editingStage !== "new" ? editingStage : null;

  function saveStage() {
    if (!stageDraftTrimmed || !editingStage) return;
    if (editingStage === "new") addStage.mutate({ projectId: current.id, name: stageDraftTrimmed });
    else renameStage.mutate({ projectId: current.id, stageId: editingStage.id, name: stageDraftTrimmed });
    setEditingStage(null);
  }

  return (
    <Screen>
      <MobileHeader
        title={workspace?.name || "Project"}
        back
        large={false}
        actions={
          <>
            <HeaderIconButton label="Project settings" onPress={() => setPicker("settings")}>
              <Settings2 size={19} color={colors.foreground} />
            </HeaderIconButton>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const completing = !project.completedAt;
                persist({ completedAt: completing ? new Date().toISOString() : "" });
                if (completing) showUndoToast("Project completed", () => persist({ completedAt: "" }));
              }}
              style={styles.done}
            >
              <Check size={16} color={colors.primaryForeground} />
              <Text style={styles.doneText}>{project.completedAt ? "Reopen" : "Done"}</Text>
            </Pressable>
          </>
        }
      />
      <FocusGroupScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
        <Field
          bare
          large
          value={title}
          onChangeText={(next) => {
            setTitle(next);
            scheduleSave({ title: next });
          }}
          onBlur={() => void flushSave()}
          placeholder="Project title"
          autoCapitalize="words"
          testID="project-title"
        />
        <PropertyGroup tone="card">
          <PropertyRow
            icon={<CircleDot size={16} color={statusRecord?.color || colors.mutedForeground} />}
            label="Status"
            value={statusRecord?.name || "None"}
            onPress={() => setPicker("status")}
          />
          <PropertyRow
            icon={<Flag size={16} color={colors.mutedForeground} />}
            label="Priority"
            value={priority || "None"}
            onPress={() => setPicker("priority")}
          />
          <PropertyRow
            icon={<CalendarDays size={16} color={colors.mutedForeground} />}
            label="Start"
            value={project.startDate ? formatShortDate(project.startDate) : "None"}
            onPress={() => setPicker("start")}
          />
          <PropertyRow
            icon={<CalendarClock size={16} color={colors.mutedForeground} />}
            label="Deadline"
            value={project.deadline ? formatShortDate(project.deadline) : "None"}
            onPress={() => setPicker("deadline")}
          />
          <PropertyRow
            icon={<View style={[styles.colourIcon, { backgroundColor: accent }]} />}
            label="Colour"
            value={colorName(project.color)}
            onPress={() => setPicker("color")}
          />
          <PropertyRow
            icon={<Columns3 size={16} color={colors.mutedForeground} />}
            label="Stages"
            value={project.doesHaveStages || stages.length ? `${stages.length} stage${stages.length === 1 ? "" : "s"}` : "Off"}
            onPress={() => setPicker("settings")}
          />
        </PropertyGroup>
        <DescriptionCard
          onSelectionChange={setAssistantSelection}
          content={isRichContentEmpty(noteRich) ? { type: "doc", content: [{ type: "paragraph" }] } : noteRich}
          syncKey={noteSync}
          placeholder="Write a description. Type '/' for blocks…"
          writeContext={{ kind: "project", title }}
          onChange={({ content, plainText }) => {
            setNoteRich(content);
            setNote(plainText);
            scheduleSave({ description: plainText, descriptionRich: content });
          }}
        />
        {/* Under the brief and its fields, where web's Overview shows it. */}
        <ProjectInsightsCard project={project} />
        <SectionLabel
          action={
            <Button
              label={`Open ${projectTasks.length} in Tasks`}
              variant="ghost"
              size="sm"
              onPress={() => router.push({ pathname: "/(app)/(tabs)/tasks", params: { projectId: project.id } })}
            />
          }
        >
          Tasks
        </SectionLabel>
        <FocusGroup style={styles.addRow}>
          <View style={{ flex: 1 }}>
            <Field value={taskTitle} onChangeText={setTaskTitle} placeholder="Add a task" autoCapitalize="sentences" />
          </View>
          <Button
            label="Add"
            size="lg"
            loading={createTask.isPending}
            disabled={!taskTitle.trim()}
            icon={<Plus size={16} color={colors.primaryForeground} />}
            onPress={() => {
              const name = taskTitle.trim();
              if (!name) return;
              void createTask
                .mutateAsync({
                  name,
                  kind: "task",
                  duration: 30,
                  projectId: project.id,
                  workspaceId: project.workspaceId,
                  statusId: workspace?.status?.find((status) => status.isDefault)?.id ?? workspace?.status?.[0]?.id,
                })
                .then(() => setTaskTitle(""));
            }}
          />
        </FocusGroup>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            requestQuickAdd({ kind: "task", projectId: project.id, workspaceId: project.workspaceId })
          }
          hitSlop={6}
          style={styles.composer}
        >
          <Text style={styles.link}>Full composer</Text>
        </Pressable>
        {projectTasks.length === 0 ? (
          <EmptyState icon={ListTodo} title="No tasks" description="Add a task above or open the full composer." compact />
        ) : (
          board
            .filter((column) => column.id || column.tasks.length > 0)
            .map((column) => (
              <View key={column.id || "unstaged"} style={styles.column}>
                <View style={styles.head}>
                  <Text style={styles.group}>{column.name}</Text>
                  <Text style={styles.meta}>{column.tasks.length}</Text>
                </View>
                {column.tasks.map((task) => (
                  <AnimatedPressable
                    key={task.id}
                    onPress={() => router.push(`/(app)/tasks/${task.id}`)}
                    onLongPress={() => setMovingTask(task)}
                    style={styles.task}
                  >
                    <Text style={[styles.item, task.completedAt ? styles.itemDone : null]}>{task.name}</Text>
                    <Text style={styles.meta}>{task.status?.name || "Hold to move stage"}</Text>
                  </AnimatedPressable>
                ))}
              </View>
            ))
        )}
        <RelatedList kind="project" id={project.id} />
        <SectionLabel>Activity</SectionLabel>
        <Text style={styles.meta}>Edits to the project’s own title, dates and description are not recorded yet.</Text>
        {(activity.data ?? []).slice(0, 20).map((entry) => (
          <View key={entry.id} style={styles.task}>
            <Text style={styles.item}>{entry.message || `${entry.actorName} ${entry.action}`}</Text>
            <Text style={styles.meta}>
              {entry.taskName ? `${entry.taskName} · ` : ""}
              {timeAgo(entry.createdAt)}
            </Text>
          </View>
        ))}
      </FocusGroupScrollView>

      <BottomSheet
        open={picker === "settings"}
        onClose={() => {
          setEditingStage(null);
          setPicker(null);
        }}
        title="Project settings"
        subtitle={title || project.title}
      >
        <View style={styles.sheetBody}>
          <GroupLabel aside={stages.length || undefined}>Stages</GroupLabel>
          {!project.doesHaveStages ? (
            <View style={styles.stagesOff}>
              <Text style={styles.hint}>Group this project's tasks into stages such as Design, Build and Launch.</Text>
              <Button label="Turn on stages" variant="outline" size="sm" onPress={() => persist({ doesHaveStages: true })} />
            </View>
          ) : null}
          {project.doesHaveStages || stages.length > 0 ? (
            <ListGroup testID="project-stages">
              {stages.map((stage, index) => (
                <ListRow
                  key={stage.id}
                  title={stage.name}
                  leading={<Text style={styles.stageIndex}>{index + 1}</Text>}
                  onPress={() => {
                    setEditingStage(stage);
                    setStageDraft(stage.name);
                  }}
                  chevron={false}
                  trailing={
                    <View style={styles.stageMoves}>
                      <Button
                        label={`Move ${stage.name} up`}
                        iconOnly
                        variant="ghost"
                        size="sm"
                        disabled={index === 0}
                        icon={<ChevronUp size={18} color={colors.mutedForeground} />}
                        onPress={() => moveStage(index, -1)}
                      />
                      <Button
                        label={`Move ${stage.name} down`}
                        iconOnly
                        variant="ghost"
                        size="sm"
                        disabled={index === stages.length - 1}
                        icon={<ChevronDown size={18} color={colors.mutedForeground} />}
                        onPress={() => moveStage(index, 1)}
                      />
                    </View>
                  }
                />
              ))}
              {project.doesHaveStages ? (
                <ListRow
                  key="__new"
                  tone="add"
                  title="New stage"
                  testID="project-new-stage"
                  onPress={() => {
                    setEditingStage("new");
                    setStageDraft("");
                  }}
                />
              ) : null}
            </ListGroup>
          ) : null}
          <GroupLabel>Project</GroupLabel>
          <ListGroup>
            <ListRow
              title={duplicate.isPending ? "Duplicating…" : "Duplicate project"}
              meta="Copies its stages and tasks"
              leading={<Copy size={18} color={colors.mutedForeground} />}
              chevron={false}
              disabled={duplicate.isPending}
              onPress={() =>
                void duplicate.mutateAsync(project.id).then((copy) => {
                  setPicker(null);
                  router.push(`/(app)/projects/${copy.id}`);
                })
              }
            />
            <ListRow
              tone="danger"
              title="Delete project"
              testID="project-delete"
              leading={<Trash2 size={18} color={colors.destructive} />}
              onPress={() => {
                const copy = projectDeleteCopy(title, projectTasks.length, stages.length);
                setConfirm({
                  title: copy.title,
                  message: copy.description,
                  confirmLabel: copy.confirmLabel,
                  onConfirm: () => remove.mutate(project.id, { onSuccess: () => router.replace("/(app)/projects") }),
                });
              }}
            />
          </ListGroup>
        </View>
        <BottomSheet
          open={editingStage !== null}
          onClose={() => setEditingStage(null)}
          title={editingStageItem ? "Edit stage" : "New stage"}
          footer={<PrimaryButton label={editingStageItem ? "Save stage" : "Add stage"} disabled={!stageDraftTrimmed} onPress={saveStage} />}
        >
          <View style={styles.sheetBody}>
            <Field label="Name" value={stageDraft} onChangeText={setStageDraft} placeholder="Design" autoCapitalize="words" />
            {editingStageItem ? (
              <View style={styles.deleteRow}>
                <Button
                  label="Delete stage"
                  variant="destructive-ghost"
                  size="sm"
                  icon={<Trash2 size={16} color={colors.destructive} />}
                  onPress={() =>
                    setConfirm({
                      title: `Delete “${editingStageItem.name}”?`,
                      message: "Tasks in this stage become unstaged.",
                      onConfirm: () => {
                        deleteStage.mutate({ projectId: project.id, stageId: editingStageItem.id });
                        setEditingStage(null);
                      },
                    })
                  }
                />
              </View>
            ) : null}
          </View>
        </BottomSheet>
        <ConfirmSheet
          open={confirm !== null}
          onClose={() => setConfirm(null)}
          title={confirm?.title ?? ""}
          message={confirm?.message}
          confirmLabel={confirm?.confirmLabel}
          onConfirm={() => confirm?.onConfirm()}
        />
      </BottomSheet>
      <ColourSheet
        open={picker === "color"}
        onClose={() => setPicker(null)}
        value={project.color ?? ""}
        autoColor={stableColorForId(project.id)}
        onChange={(color) => persist({ color })}
      />
      <BottomSheet open={picker === "status"} onClose={() => setPicker(null)} title="Status">
        <SheetOption
          selected={!project.statusId}
          onSelect={() => {
            persist({ statusId: "" });
            setPicker(null);
          }}
        >
          None
        </SheetOption>
        {(workspace?.status ?? []).map((status) => (
          <SheetOption
            key={status.id}
            selected={status.id === project.statusId}
            leading={<ColorDot color={status.color} />}
            onSelect={() => {
              persist({ statusId: status.id });
              setPicker(null);
            }}
          >
            {status.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={picker === "priority"} onClose={() => setPicker(null)} title="Priority">
        <SheetOption
          selected={!priority}
          onSelect={() => {
            persist({ priorityLevel: "" });
            setPicker(null);
          }}
        >
          None
        </SheetOption>
        {PRIORITIES.map((level) => (
          <SheetOption
            key={level}
            selected={priority === level}
            onSelect={() => {
              persist({ priorityLevel: level });
              setPicker(null);
            }}
          >
            {level}
          </SheetOption>
        ))}
      </BottomSheet>
      <BottomSheet open={Boolean(movingTask)} onClose={() => setMovingTask(null)} title="Move to stage">
        <SheetOption selected={!movingTask?.stageId} onSelect={() => movingTask && assignStage(movingTask, null)}>
          Unstaged
        </SheetOption>
        {stages.map((stage) => (
          <SheetOption
            key={stage.id}
            selected={movingTask?.stageId === stage.id}
            onSelect={() => movingTask && assignStage(movingTask, stage.id)}
          >
            {stage.name}
          </SheetOption>
        ))}
      </BottomSheet>
      <DateTimeSheet
        open={picker === "start" || picker === "deadline"}
        value={
          picker === "deadline" && project.deadline
            ? new Date(project.deadline)
            : picker === "start" && project.startDate
              ? new Date(project.startDate)
              : new Date()
        }
        mode="date"
        title={picker === "deadline" ? "Deadline" : "Start"}
        onClose={() => setPicker(null)}
        onChange={(next) => {
          const value = next ? toDateInputValue(next) : "";
          if (picker === "start") persist({ startDate: value });
          if (picker === "deadline") persist({ deadline: value });
        }}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  done: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 4,
  },
  doneText: { color: colors.primaryForeground, fontWeight: "600", fontSize: 12 },
  meta: { color: colors.mutedForeground, fontSize: 12 },
  hint: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  item: { flex: 1, color: colors.foreground },
  itemDone: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  link: { color: colors.mutedForeground, fontWeight: "600", fontSize: 13 },
  composer: { alignSelf: "flex-start", paddingHorizontal: 2, marginTop: -4 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  column: { gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 },
  group: { flex: 1, color: colors.foreground, fontWeight: "600" },
  task: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 4,
  },
  sheetBody: { gap: 10, paddingBottom: 4 },
  stagesOff: { gap: 10, alignItems: "flex-start", paddingHorizontal: 4 },
  stageIndex: { width: 18, color: colors.mutedForeground, fontSize: 13, fontWeight: "600", textAlign: "center" },
  stageMoves: { flexDirection: "row", alignItems: "center", marginRight: -8 },
  deleteRow: { alignItems: "flex-start", marginLeft: -12 },
  colourIcon: { width: 16, height: 16, borderRadius: 8 },
}));
