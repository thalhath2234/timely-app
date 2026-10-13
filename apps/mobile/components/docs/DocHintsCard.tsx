import { docTypePhrase } from "@timely/contract/documents";
import { checklistTaskDescription, docWorkLines, openChecklistItems, workLineKey, type ChecklistTodo } from "@timely/contract/docChecklist";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { FolderKanban, ListTodo, Plus, Sparkles, X } from "lucide-react-native";
import { contentFromTemplate, templateVars } from "@timely/contract/templates";
import AnimatedPressable from "../ui/AnimatedPressable";
import ConfirmSheet from "../ui/ConfirmSheet";
import { getDoc } from "../../lib/api/docs";
import { Button, SectionLabel } from "../ui/primitives";
import {
  useCreateTask,
  useDecisionFeedback,
  useDeleteTask,
  useDismissDocHint,
  useDocChecklistQuery,
  useDocHintsQuery,
  useRelatedQuery,
  useUpdateDoc,
} from "../../lib/hooks";
import { hrefFor } from "../../lib/searchRoutes";
import { showUndoToast, useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import type { DocHintKind } from "../../lib/api/decisions";
import type { Doc, DocContent, Task } from "../../lib/types";

type Row = {
  key: string;
  text: string;
  label?: string;
  run?: () => void;
  manual?: boolean;
  /** What the server remembers when the row is dismissed. */
  kind: DocHintKind;
  value?: string;
};

/** Smart suggestions for a doc on the phone, as on the web: a template for a
 * near-empty page, the project or page it may belong under, its type and
 * property values (set in the doc's Properties block), lines that read like
 * tasks, and whether it looks out of date. Above them, the doc's unchecked
 * checklist items that are not tasks yet, offered as tasks even while
 * suggestions are off. */
export default function DocHintsCard({
  doc,
  content,
  version,
  nearEmpty = false,
  isEmpty,
  onSetProperty,
  onApplyContent,
}: {
  doc: Doc;
  /** The open editor's content, a moment after typing stops. */
  content: DocContent | null | undefined;
  version: string;
  /** A template is only offered while the page is still near-empty. */
  nearEmpty?: boolean;
  /** Whether the page holds nothing at all; otherwise using a template asks first. */
  isEmpty?: () => boolean;
  /** Sets one property in the open editor; type and property rows need it. */
  onSetProperty?: (key: string, value: string) => void;
  /** Replaces the page's content; the template row needs it. */
  onApplyContent?: (content: DocContent, plainText: string) => void;
}) {
  const live = !doc.isTemplate && !doc.archivedAt;
  const { data } = useDocHintsQuery(doc.id, version, live);
  const updateDoc = useUpdateDoc();
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const queryClient = useQueryClient();
  const feedback = useDecisionFeedback();
  const dismissHint = useDismissDocHint(doc.id);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  const [making, setMaking] = useState<string | null>(null);

  const todos = useMemo(() => (live ? openChecklistItems(content) : []), [content, live]);
  // Suggestions are read when the word count moves on, so a line read
  // mid-typing, or since turned into a checklist item, can still be in them.
  const lines = useMemo(() => docWorkLines(content), [content]);
  const names = useMemo(() => todos.map((todo) => todo.name), [todos]);
  // New tasks go to the doc's project, else the one suggestions place the doc
  // in, else the project it is most related to; the server checks the pick.
  const related = useRelatedQuery("doc", doc.id).data;
  const proposed = doc.projectId || data?.project?.id || related?.find((item) => item.kind === "project")?.id;
  const checklist = useDocChecklistQuery(doc.id, names, proposed ?? undefined);
  const target = checklist.data?.project;
  const taken = new Set((checklist.data?.existing ?? []).map((task) => task.name.toLowerCase()));
  const checked = new Set((checklist.data?.names ?? []).map((name) => name.toLowerCase()));
  const open = todos.filter((todo) => {
    const key = todo.name.toLowerCase();
    return checked.has(key) && !taken.has(key) && !hidden.has(`todo:${key}`);
  });
  // Items that are tasks already are named under the open ones, so it is
  // clear why they are not offered; alone they are not worth a card.
  const already = (checklist.data?.existing ?? []).filter((task) => todos.some((todo) => todo.name.toLowerCase() === task.name.toLowerCase()));
  const router = useRouter();

  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));
  const make = async (list: ChecklistTodo[], key: string) => {
    setMaking(key);
    const made: Task[] = [];
    for (const todo of list) {
      try {
        made.push(
          await createTask.mutateAsync({
            name: todo.name,
            kind: "task",
            duration: 30,
            workspaceId: target?.workspaceId ?? doc.workspaceId,
            projectId: target?.id,
            ...checklistTaskDescription(todo.details, doc),
          }),
        );
        hide(`todo:${todo.name.toLowerCase()}`);
      } catch {
        // Reported below with the count.
      }
    }
    setMaking(null);
    void queryClient.invalidateQueries({ queryKey: ["doc-checklist", doc.id] });
    if (!made.length) {
      useToastStore.getState().show("Could not add the task");
      return;
    }
    const where = target ? ` to ${target.title}` : "";
    const message =
      made.length === 1 ? `Task added${where}: ${made[0].name}` : `${made.length} tasks added${where}${made.length < list.length ? `, ${list.length - made.length} failed` : ""}`;
    showUndoToast(message, () => {
      for (const task of made) deleteTask.mutate(task.id);
      setHidden((prev) => {
        const next = new Set(prev);
        for (const task of made) next.delete(`todo:${task.name.toLowerCase()}`);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["doc-checklist", doc.id] });
    });
  };

  const hints = data?.available ? data : undefined;
  const accept = () => {
    if (data?.logId && !sent) {
      setSent(true);
      feedback.mutate({ logId: data.logId, accepted: true });
    }
  };

  const rows: Row[] = [];
  const template = nearEmpty && onApplyContent ? hints?.template : undefined;
  const applyTemplate = async () => {
    if (!template || !onApplyContent) return;
    try {
      const source = await getDoc(template.id);
      const { content, plainText } = contentFromTemplate(
        { id: source.id, title: source.title, icon: source.icon || "📄", content: source.content },
        templateVars(new Date(), doc.title || source.title),
      );
      onApplyContent(content as DocContent, plainText);
      accept();
      hide("template");
    } catch {
      useToastStore.getState().show("Could not open that template");
    }
  };
  if (template) {
    rows.push({
      key: "template",
      kind: "template",
      value: template.id,
      text: `Start from the “${template.title}” template?`,
      label: "Use template",
      manual: true,
      // Few words can still mean an image or a table is there.
      run: () => (isEmpty?.() === false ? setConfirmTemplate(true) : void applyTemplate()),
    });
  }
  const project = hints?.project;
  if (project && !doc.projectId) {
    rows.push({
      key: "project",
      kind: "project",
      value: project.id,
      text: `Looks like part of the “${project.title}” project.`,
      label: "Add",
      run: () => {
        updateDoc.mutate({ id: doc.id, data: { projectId: project.id } });
        showUndoToast(`Added to ${project.title}`, () => updateDoc.mutate({ id: doc.id, data: { projectId: null } }));
      },
    });
  }
  const parent = hints?.parent;
  if (parent && !doc.parentId) {
    rows.push({
      key: "parent",
      kind: "parent",
      value: parent.id,
      text: `Could live under “${parent.title}”.`,
      label: "Move",
      run: () => {
        updateDoc.mutate({ id: doc.id, data: { parentId: parent.id } });
        showUndoToast(`Moved under ${parent.title}`, () => updateDoc.mutate({ id: doc.id, data: { parentId: null } }));
      },
    });
  }
  if (onSetProperty && hints?.docType) {
    const docType = hints.docType;
    rows.push({
      key: "type",
      kind: "type",
      value: docType,
      text: `Reads like ${docTypePhrase(docType)}.`,
      label: "Set type",
      run: () => onSetProperty("type", docType),
    });
  }
  if (onSetProperty) {
    for (const p of hints?.properties ?? []) {
      rows.push({
        key: `prop:${p.key}`,
        kind: "prop",
        value: `${p.key}=${p.value}`,
        text: `Set ${p.key} to “${p.value}”, as in your other docs?`,
        label: "Set",
        run: () => onSetProperty(p.key, p.value),
      });
    }
  }
  for (const line of (hints?.work ?? []).filter((line) => lines.has(workLineKey(line)))) {
    rows.push({
      key: `work:${line}`,
      kind: "work",
      value: line,
      text: `“${line}” reads like a task.`,
      label: "Create task",
      run: () =>
        void createTask
          .mutateAsync({ name: line, kind: "task", duration: 30, workspaceId: doc.workspaceId, projectId: doc.projectId ?? undefined })
          .then(() => useToastStore.getState().show(`Task added: ${line}`))
          .catch(() => useToastStore.getState().show("Could not add the task"))
          // Read again, so a reopened doc does not offer the line it made.
          .finally(() => void queryClient.invalidateQueries({ queryKey: ["doc-hints", doc.id] })),
    });
  }
  if (hints?.outdated) {
    rows.push({
      key: "outdated",
      kind: "outdated",
      text: "This doc may be out of date. It has not been edited in a while and talks about plans or dates that have likely passed.",
    });
  }
  const shown = rows.filter((row) => !hidden.has(row.key));
  if (!shown.length && !open.length && !confirmTemplate) return null;

  return (
    <View style={styles.card} testID="doc-hints">
      {open.length > 0 ? (
        <View style={styles.todos} testID="doc-checklist-tasks">
          <View style={styles.todoHeader}>
            <ListTodo size={16} color={colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.todoTitle}>
                {open.length === 1 ? "1 checklist item isn’t a task yet" : `${open.length} checklist items aren’t tasks yet`}
              </Text>
              {target ? (
                <View style={styles.target}>
                  <Text style={styles.text}>Goes to</Text>
                  <FolderKanban size={13} color={colors.mutedForeground} />
                  <Text numberOfLines={1} style={[styles.text, styles.strong, { flexShrink: 1 }]}>{target.title}</Text>
                </View>
              ) : null}
            </View>
          </View>
          {open.map((todo) => {
            const key = `todo:${todo.name.toLowerCase()}`;
            return (
              <View key={key} style={styles.todoRow}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text numberOfLines={3} style={[styles.text, styles.strong]}>{todo.name}</Text>
                  {todo.details ? <Text numberOfLines={2} style={styles.text}>{todo.details}</Text> : null}
                </View>
                {/* Icon only: on a 390px phone a labelled button left the item's
                    own words two cut-off lines. The section title says what + does. */}
                <Button
                  size="sm"
                  variant="outline"
                  iconOnly
                  label="Make task"
                  accessibilityLabel={`Make task: ${todo.name}`}
                  icon={<Plus size={16} color={colors.foreground} />}
                  loading={making === key}
                  disabled={making !== null}
                  onPress={() => void make([todo], key)}
                />
                <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Dismiss ${todo.name}`} onPress={() => hide(key)} style={styles.dismiss} hitSlop={8}>
                  <X size={14} color={colors.mutedForeground} />
                </AnimatedPressable>
              </View>
            );
          })}
          {already.length > 0 ? (
            <Text style={[styles.text, styles.already]}>
              Already {already.length === 1 ? "a task" : "tasks"}:{" "}
              {already.map((task, i) => (
                <Text key={task.taskId}>
                  {i > 0 ? ", " : ""}
                  <Text accessibilityRole="link" onPress={() => router.push(hrefFor("task", task.taskId))} style={styles.link}>
                    {todos.find((todo) => todo.name.toLowerCase() === task.name.toLowerCase())?.name ?? task.name}
                  </Text>
                </Text>
              ))}
            </Text>
          ) : null}
          {open.length > 1 ? (
            <Button
              size="sm"
              variant="secondary"
              stretch
              label={`Make ${open.length} tasks`}
              icon={<Plus size={16} color={colors.foreground} />}
              loading={making === "all"}
              disabled={making !== null}
              onPress={() => void make(open, "all")}
            />
          ) : null}
        </View>
      ) : null}
      {open.length > 0 && shown.length > 0 ? <View style={styles.divider} /> : null}
      {shown.length > 0 ? (
        <View style={styles.header}>
          <Sparkles size={16} color={colors.primary} />
          <SectionLabel compact>Suggestions</SectionLabel>
        </View>
      ) : null}
      {shown.map((row) => (
        <View key={row.key} style={styles.row}>
          <Text style={[styles.text, { flex: 1 }]}>{row.text}</Text>
          {row.run ? (
            <AnimatedPressable
              accessibilityRole="button"
              onPress={() => {
                row.run!();
                if (row.manual) return;
                accept();
                hide(row.key);
              }}
              style={styles.button}
            >
              <Text style={styles.buttonText}>{row.label}</Text>
            </AnimatedPressable>
          ) : null}
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={() => {
              hide(row.key);
              dismissHint.mutate({ kind: row.kind, value: row.value });
            }}
            style={styles.dismiss}
            hitSlop={8}
          >
            <X size={14} color={colors.mutedForeground} />
          </AnimatedPressable>
        </View>
      ))}
      <ConfirmSheet
        open={confirmTemplate}
        onClose={() => setConfirmTemplate(false)}
        title={`Replace this page with “${template?.title ?? ""}”?`}
        message="What the page holds now is replaced. Version history keeps the current copy."
        confirmLabel="Replace"
        onConfirm={() => void applyTemplate()}
      />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 8, marginHorizontal: 16, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  button: { minHeight: 32, borderRadius: 10, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary },
  buttonText: { color: colors.foreground, fontSize: 12, fontWeight: "600" },
  dismiss: { padding: 4 },
  todos: { gap: 8 },
  todoHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  todoTitle: { color: colors.foreground, fontSize: 14, lineHeight: 19, fontWeight: "600" },
  target: { flexDirection: "row", alignItems: "center", gap: 4 },
  strong: { color: colors.foreground, fontWeight: "500" },
  todoRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 24 },
  already: { paddingLeft: 24, fontSize: 12 },
  link: { color: colors.primary, fontWeight: "500" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
}));
