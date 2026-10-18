import { docTypePhrase } from "@timely/contract/documents";
import { checklistTask, docWorkLines, draftChecklistTasks, openChecklistItems, workLineKey, workLineTask, type ChecklistTodo } from "@timely/contract/docChecklist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ChevronRight, FolderKanban, ListTodo, Plus, Sparkles, X } from "lucide-react-native";
import { contentFromTemplate, templateVars } from "@timely/contract/templates";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import { getDoc } from "../../lib/api/docs";
import { checklistTaskDrafts } from "../../lib/api/write";
import { readyProviders } from "../chat/ModelSheet";
import { Button, SectionLabel } from "../ui/primitives";
import {
  useAgentProvidersQuery,
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
import { checklistLines, type LineHint, type LineHints } from "./lineHints";

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
 * suggestions are off. Above the doc it is one summary row; the rows
 * themselves open in a sheet, so the doc keeps the screen. Checklist rows
 * also get a marker in the doc itself (`onLineHints`), which opens a card
 * with that row's suggestion under it. */
export default function DocHintsCard({
  doc,
  content,
  version,
  nearEmpty = false,
  isEmpty,
  onSetProperty,
  onApplyContent,
  onLineHints,
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
  /** The markers and cards for checklist rows in the doc, for the editor;
   * null once there are none. */
  onLineHints?: (value: LineHints | null) => void;
}) {
  const live = !doc.isTemplate && !doc.archivedAt;
  const { data } = useDocHintsQuery(doc.id, version, live);
  const updateDoc = useUpdateDoc();
  const createTask = useCreateTask();
  const dismissHint = useDismissDocHint(doc.id);
  const deleteTask = useDeleteTask();
  const queryClient = useQueryClient();
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  const [making, setMaking] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // With an AI provider set up (Settings > Agent keys), Make task first asks
  // its default model for a clean title and a brief description.
  const aiReady = readyProviders(useAgentProvidersQuery().data).length > 0;

  // Checklists Jev reads as kept in the doc (groceries, packing) offer no tasks.
  const kept = data?.available ? data.keptLists : undefined;
  const todos = useMemo(() => (live ? openChecklistItems(content, kept) : []), [content, live, kept]);
  // Suggestions are read when the word count moves on, so a line read
  // mid-typing, or since turned into a checklist item, can still be in them.
  const workLines = useMemo(() => docWorkLines(content), [content]);
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
    // One request for all the items, a few seconds at most; without a
    // provider, or on any error, the tasks keep the items' own words.
    const drafts = aiReady ? await draftChecklistTasks(list, doc, (body) => checklistTaskDrafts(body)) : list.map(() => null);
    const made: Task[] = [];
    // The card's key of the item each task came from; the name may differ.
    const from = new Map<string, string>();
    for (const [i, todo] of list.entries()) {
      try {
        const task = await createTask.mutateAsync({
          ...checklistTask(todo, doc, drafts[i]),
          kind: "task",
          duration: 30,
          workspaceId: target?.workspaceId ?? doc.workspaceId,
          projectId: target?.id,
        });
        made.push(task);
        from.set(task.id, `todo:${todo.name.toLowerCase()}`);
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
        for (const task of made) next.delete(from.get(task.id) ?? `todo:${task.name.toLowerCase()}`);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["doc-checklist", doc.id] });
    });
  };

  // The rows' markers and cards in the doc. The editor gets plain data and
  // one stable `act`, so it is only told again when what it shows changes.
  const [openLine, setOpenLine] = useState<string | null>(null);
  const lines = useMemo(() => checklistLines(content), [content]);
  const lineHints: LineHint[] = [
    ...open.map((todo) => ({
      key: `todo:${todo.name.toLowerCase()}`,
      kind: "todo" as const,
      text: lines.get(todo.name.toLowerCase()) ?? "",
      name: todo.name,
      details: todo.details,
    })),
    ...already.map((task) => ({ key: `task:${task.taskId}`, kind: "task" as const, text: lines.get(task.name.toLowerCase()) ?? "", name: task.name })),
  ].filter((hint) => hint.text);
  const actRef = useRef<LineHints["act"]>(() => undefined);
  actRef.current = (key, action) => {
    if (key.startsWith("task:")) {
      router.push(hrefFor("task", key.slice("task:".length)));
      return;
    }
    const todo = open.find((item) => `todo:${item.name.toLowerCase()}` === key);
    if (action === "toggle") setOpenLine((current) => (current === key ? null : key));
    else if (action === "dismiss") hide(key);
    else if (todo) void make([todo], key);
  };
  const act = useCallback<LineHints["act"]>((key, action) => actRef.current(key, action), []);
  const lineSignature = JSON.stringify([lineHints, openLine, making, target?.title ?? null, aiReady]);
  const onLineHintsRef = useRef(onLineHints);
  onLineHintsRef.current = onLineHints;
  useEffect(() => {
    const [hintList, openKey, busy, targetTitle, writing] = JSON.parse(lineSignature) as [LineHint[], string | null, string | null, string | null, boolean];
    onLineHintsRef.current?.(hintList.length ? { hints: hintList, open: openKey, busy, target: targetTitle, writing, act } : null);
  }, [lineSignature, act]);
  useEffect(() => () => onLineHintsRef.current?.(null), []);

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
  for (const line of (hints?.work ?? []).filter((line) => workLines.has(workLineKey(line)))) {
    rows.push({
      key: `work:${line}`,
      kind: "work",
      value: line,
      text: `“${line}” reads like a task.`,
      label: "Create task",
      run: () =>
        void createTask
          .mutateAsync({ ...workLineTask(line, doc), kind: "task", duration: 30, workspaceId: doc.workspaceId, projectId: doc.projectId ?? undefined })
          .then(() => {
            useToastStore.getState().show(`Task added: ${line}`);
            // Kept for the doc, so the line is not offered again once it or
            // the task is reworded; this reads the suggestions again too.
            dismissHint.mutate({ kind: "work", value: line });
          })
          .catch(() => useToastStore.getState().show("Could not add the task")),
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

  const body = (
    <View style={styles.body} testID="doc-hints">
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
              label={aiReady && making === "all" ? "Writing titles…" : `Make ${open.length} tasks`}
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
    </View>
  );

  const summary = open.length
    ? open.length === 1
      ? "1 item isn’t a task yet"
      : `${open.length} items aren’t tasks yet`
    : shown.length === 1
      ? "1 suggestion for this doc"
      : `${shown.length} suggestions for this doc`;
  const detail = [
    open.length && target ? `Goes to ${target.title}` : "",
    open.length && shown.length ? `${shown.length} more ${shown.length === 1 ? "suggestion" : "suggestions"}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <>
      {shown.length || open.length ? (
        // "Make all" sits beside the row, not inside it: one button may not hold another.
        <View style={styles.summary}>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={`${summary}. Show`}
            onPress={() => setSheetOpen(true)}
            style={styles.summaryOpen}
            testID="doc-hints-summary"
          >
            {open.length ? <ListTodo size={16} color={colors.primary} /> : <Sparkles size={16} color={colors.primary} />}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={styles.todoTitle}>{summary}</Text>
              {detail ? <Text numberOfLines={1} style={styles.text}>{detail}</Text> : null}
            </View>
            {open.length > 1 ? null : <ChevronRight size={18} color={colors.mutedForeground} />}
          </AnimatedPressable>
          {open.length > 1 ? (
            <Button
              size="sm"
              variant="secondary"
              label={aiReady && making === "all" ? "Writing…" : "Make all"}
              accessibilityLabel={`Make ${open.length} tasks`}
              loading={making === "all"}
              disabled={making !== null}
              onPress={() => void make(open, "all")}
            />
          ) : null}
        </View>
      ) : null}
      <BottomSheet open={sheetOpen && (shown.length > 0 || open.length > 0)} onClose={() => setSheetOpen(false)} title="Suggestions">
        {body}
      </BottomSheet>
      <ConfirmSheet
        open={confirmTemplate}
        onClose={() => setConfirmTemplate(false)}
        title={`Replace this page with “${template?.title ?? ""}”?`}
        message="What the page holds now is replaced. Version history keeps the current copy."
        confirmLabel="Replace"
        onConfirm={() => void applyTemplate()}
      />
    </>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 52,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingLeft: 14,
    paddingRight: 8,
  },
  summaryOpen: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 50 },
  body: { gap: 8, paddingHorizontal: 4, paddingBottom: 8 },
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
