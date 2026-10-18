import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { contextChip } from "../../../lib/chat/context";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
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
import { Button, Field, PrimaryButton } from "../../../components/ui/primitives";
import { ColorDot, GroupHint, GroupLabel, ListGroup, ListRow } from "../../../components/settings/SettingsList";
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
import { formatShortDate, PRIORITY_META, timeAgo, toDateInputValue } from "../../../lib/format";
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
        <ListGroup>
          <ListRow
            title="Status"
            trailing={<RowValue text={statusRecord?.name || "None"} dot={statusRecord?.color || colors.mutedForeground} />}
            onPress={() => setPicker("status")}
          />
          <ListRow
            title="Priority"
            trailing={
              <RowValue
                text={priority || "None"}
                tint={priority === "High" || priority === "Urgent" ? PRIORITY_META[priority]?.color : undefined}
              />
            }
            onPress={() => setPicker("priority")}
          />
          <ListRow title="Start date" trailing={project.startDate ? formatShortDate(project.startDate) : "None"} onPress={() => setPicker("start")} />
          <ListRow title="Deadline" trailing={project.deadline ? formatShortDate(project.deadline) : "None"} onPress={() => setPicker("deadline")} />
          <ListRow title="Colour" trailing={<RowValue text={colorName(project.color)} dot={accent} />} onPress={() => setPicker("color")} />
          <ListRow
            title="Stages"
            trailing={project.doesHaveStages || stages.length ? `${stages.length} stage${stages.length === 1 ? "" : "s"}` : "Off"}
            onPress={() => setPicker("settings")}
          />
        </ListGroup>
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
        <View style={styles.section}>
          <GroupLabel
            aside={
              projectTasks.length ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => router.push({ pathname: "/(app)/(tabs)/tasks", params: { projectId: project.id } })}
                >
                  <Text style={styles.inlineAction}>{`Open ${projectTasks.length} in Tasks`}</Text>
                </Pressable>
              ) : undefined
            }
          >
            Tasks
          </GroupLabel>
          <FocusGroup>
            <ListGroup>
              <View key="__add" style={styles.inlineRow}>
                <Plus size={18} color={colors.primary} />
                <View style={styles.inlineField}>
                  <Field value={taskTitle} onChangeText={setTaskTitle} bare placeholder="Add a task" autoCapitalize="sentences" />
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={!taskTitle.trim() || createTask.isPending}
                  hitSlop={8}
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
                >
                  <Text style={[styles.inlineAction, (!taskTitle.trim() || createTask.isPending) && styles.inlineActionOff]}>
                    {createTask.isPending ? "Adding…" : "Add"}
                  </Text>
                </Pressable>
              </View>
              <ListRow
                key="__composer"
                title="Full composer"
                meta="Dates, labels, repeat and more"
                onPress={() => requestQuickAdd({ kind: "task", projectId: project.id, workspaceId: project.workspaceId })}
              />
            </ListGroup>
          </FocusGroup>
        </View>
        {projectTasks.length === 0 ? (
          <EmptyState icon={ListTodo} title="No tasks" description="Add a task above or open the full composer." compact />
        ) : (
          <>
            {board
              .filter((column) => column.tasks.length > 0)
              .map((column) => (
                <View key={column.id || "unstaged"} style={styles.section}>
                  <GroupLabel aside={String(column.tasks.length)}>{column.name}</GroupLabel>
                  <ListGroup>
                    {column.tasks.map((task) => (
                      <ListRow
                        key={task.id}
                        title={task.name}
                        meta={task.status?.name || undefined}
                        leading={<ColorDot color={task.completedAt ? colors.success : task.status?.color} size={8} />}
                        onPress={() => router.push(`/(app)/tasks/${task.id}`)}
                        onLongPress={() => setMovingTask(task)}
                      />
                    ))}
                  </ListGroup>
                </View>
              ))}
            {stages.length > 0 ? (
              <GroupHint>
                {(() => {
                  const empty = board.filter((column) => column.id && column.tasks.length === 0).map((column) => column.name);
                  return empty.length
                    ? `Hold a task to move it to another stage. Empty: ${empty.join(", ")}.`
                    : "Hold a task to move it to another stage.";
                })()}
              </GroupHint>
            ) : null}
          </>
        )}
        <RelatedList kind="project" id={project.id} />
        <View style={styles.section}>
          <GroupLabel aside={(activity.data ?? []).length ? String(Math.min(20, (activity.data ?? []).length)) : undefined}>Activity</GroupLabel>
          {(activity.data ?? []).length ? (
            <ListGroup>
              {(activity.data ?? []).slice(0, 20).map((entry) => (
                <ListRow
                  key={entry.id}
                  title={entry.message || `${entry.actorName} ${entry.action}`}
                  meta={`${entry.taskName ? `${entry.taskName} · ` : ""}${timeAgo(entry.createdAt)}`}
                />
              ))}
            </ListGroup>
          ) : null}
          <GroupHint>Edits to the project’s own title, dates and description are not recorded yet.</GroupHint>
        </View>
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
          {!project.doesHaveStages && stages.length === 0 ? (
            <ListGroup>
              <ListRow
                tone="add"
                title="Turn on stages"
                meta="Group tasks into stages such as Design, Build and Launch"
                testID="project-turn-on-stages"
                onPress={() => persist({ doesHaveStages: true })}
              />
            </ListGroup>
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
            <ListGroup>
              <View key="name" style={styles.inlineRow}>
                <Text style={styles.inlineLabel}>Name</Text>
                <View style={styles.inlineField}>
                  <Field
                    bare
                    align="right"
                    accessibilityLabel="Stage name"
                    value={stageDraft}
                    onChangeText={setStageDraft}
                    placeholder="Design"
                    autoCapitalize="words"
                    autoFocus={!editingStageItem}
                  />
                </View>
              </View>
            </ListGroup>
            {editingStageItem ? (
              <>
                <GroupHint>Tasks in this stage become unstaged if you delete it.</GroupHint>
                <ListGroup>
                  <ListRow
                    tone="danger"
                    title="Delete stage"
                    leading={<Trash2 size={18} color={colors.destructive} />}
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
                </ListGroup>
              </>
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

function RowValue({ text, dot, tint }: { text: string; dot?: string | null; tint?: string }) {
  return (
    <View style={styles.value}>
      {dot ? <ColorDot color={dot} size={8} /> : null}
      <Text numberOfLines={1} style={[styles.valueText, tint ? { color: tint } : null]}>{text}</Text>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  value: { flexShrink: 1, maxWidth: 190, flexDirection: "row", alignItems: "center", gap: 6 },
  valueText: { flexShrink: 1, color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
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
  sheetBody: { gap: 10, paddingBottom: 4 },
  section: { gap: 6 },
  inlineRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 6 },
  inlineLabel: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  inlineField: { flex: 1, minWidth: 0 },
  inlineAction: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  inlineActionOff: { color: colors.mutedForeground, opacity: 0.6 },
  stageIndex: { width: 18, color: colors.mutedForeground, fontSize: 13, fontWeight: "600", textAlign: "center" },
  stageMoves: { flexDirection: "row", alignItems: "center", marginRight: -8 },
}));
