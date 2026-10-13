"use client";

import { docTypePhrase } from "@timely/contract/documents";
import { checklistTaskDescription, docWorkLines, openChecklistItems, workLineKey, type ChecklistTodo } from "@timely/contract/docChecklist";
import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderKanban, ListTodo, Plus, Sparkles, X } from "lucide-react";
import { contentFromTemplate, templateVars } from "@timely/contract/templates";
import type { Doc, Task } from "@/app/_types/types";
import Button from "@/app/_components/_ui/button";
import { getDoc } from "@/app/utils/api/docs";
import { useDecisionFeedback, useDismissDocHint, useDocChecklist, useDocHints } from "@/app/utils/hooks/decisions";
import type { DocHintKind } from "@/app/utils/api/decisions";
import { useUpdateDoc } from "@/app/utils/hooks/docs";
import { useRelated } from "@/app/utils/hooks/search";
import { openTasksEntity } from "@/app/utils/entityDetail";
import { useCreateTask, useDeleteTask } from "@/app/utils/hooks/tasks";
import { setDocProperty } from "@/app/_components/editor/frontmatter";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { requestConfirm } from "@/app/_store/confirmStore";

/** What smart suggestions read in a doc: a template for a near-empty page,
 * the project or page it may belong under, its type and properties, lines
 * that read like something to do, and whether it looks out of date. Above
 * them, the doc's unchecked checklist items that are not tasks yet, offered
 * as tasks even while suggestions are off. Every row can be dismissed. */
export default function DocHints({
  doc,
  editor,
  version,
  nearEmpty,
  onApplyContent,
}: {
  doc: Doc;
  editor: Editor | null;
  version: string;
  /** A template is only offered while the page is still near-empty. */
  nearEmpty: boolean;
  onApplyContent: (content: Doc["content"], plainText: string) => void;
}) {
  const live = !doc.isTemplate && !doc.archivedAt;
  const { data } = useDocHints(doc.id, version, live);
  const updateDoc = useUpdateDoc();
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const queryClient = useQueryClient();
  const feedback = useDecisionFeedback();
  const dismissHint = useDismissDocHint(doc.id);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  const [making, setMaking] = useState<string | null>(null);

  // The checklist is read from the open editor, a moment after typing stops,
  // so a ticked or deleted item leaves at once and a new one shows up.
  const [content, setContent] = useState(() => editor?.getJSON() ?? doc.content);
  useEffect(() => {
    if (!editor) return;
    setContent(editor.getJSON());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setContent(editor.getJSON()), 600);
    };
    editor.on("update", read);
    return () => {
      clearTimeout(timer);
      editor.off("update", read);
    };
  }, [editor]);
  const todos = useMemo(() => (live ? openChecklistItems(content) : []), [content, live]);
  // Suggestions are read when the word count moves on, so a line read
  // mid-typing, or since turned into a checklist item, can still be in them.
  const lines = useMemo(() => docWorkLines(content), [content]);
  const names = useMemo(() => todos.map((todo) => todo.name), [todos]);
  // New tasks go to the doc's project, else the one suggestions place the doc
  // in, else the project it is most related to; the server checks the pick.
  const related = useRelated("doc", doc.id).data;
  const proposed = doc.projectId || data?.project?.id || related?.find((item) => item.kind === "project")?.id;
  const checklist = useDocChecklist(doc.id, names, proposed ?? undefined);
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
  const accept = () => {
    if (data?.logId && !sent) {
      setSent(true);
      feedback.mutate({ logId: data.logId, accepted: true });
    }
  };

  const hints = data?.available ? data : undefined;
  const template = hints?.template && nearEmpty && !hidden.has("template") ? hints.template : undefined;
  const project = hints?.project && !doc.projectId && !hidden.has("project") ? hints.project : undefined;
  const parent = hints?.parent && !doc.parentId && !hidden.has("parent") ? hints.parent : undefined;
  const docType = hints?.docType && !hidden.has("type") ? hints.docType : undefined;
  const properties = (hints?.properties ?? []).filter((p) => !hidden.has(`prop:${p.key}`));
  const work = (hints?.work ?? []).filter((line) => !hidden.has(`work:${line}`) && lines.has(workLineKey(line)));
  const outdated = hints?.outdated && !hidden.has("outdated");
  const suggestions = Boolean(template || project || parent || docType || properties.length || work.length || outdated);
  if (!suggestions && !open.length) return null;

  // A dismissed suggestion is remembered for the doc, on every device; a
  // checklist item (no kind) only for now, as it is still a to-do.
  const dismiss = (key: string, kind?: DocHintKind, value = "") => (
    <button
      type="button"
      aria-label="Dismiss"
      onClick={() => {
        hide(key);
        if (kind) dismissHint.mutate({ kind, value });
      }}
      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  );
  const button = "shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50";
  const strong = "font-medium text-foreground";

  return (
    <section className="mb-4 rounded-xl border border-border bg-card p-3" data-testid="doc-hints" aria-label="Doc suggestions">
      {open.length > 0 && (
        <div data-testid="doc-checklist-tasks">
          <div className="flex items-center gap-2">
            <h3 className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground">
              <ListTodo className="size-4 shrink-0 text-primary" />
              <span className="font-medium text-foreground">
                {open.length === 1 ? "1 checklist item isn’t a task yet" : `${open.length} checklist items aren’t tasks yet`}
              </span>
              {target && (
                <span className="inline-flex items-center gap-1">
                  · goes to <FolderKanban className="size-3.5" /> <span className="font-medium text-foreground">{target.title}</span>
                </span>
              )}
            </h3>
            {open.length > 1 && (
              <Button size="sm" variant="soft" loading={making === "all"} disabled={making !== null} leading={<Plus />} onClick={() => void make(open, "all")}>
                Make {open.length} tasks
              </Button>
            )}
          </div>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-sm text-muted-foreground">
            {open.map((todo) => {
              const key = `todo:${todo.name.toLowerCase()}`;
              return (
                <li key={key} className="flex items-center gap-2 rounded-md py-1 pl-6 pr-1">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground" title={todo.text}>{todo.name}</span>
                    {todo.details && <span className="block truncate text-xs">{todo.details}</span>}
                  </span>
                  <Button size="sm" variant="outline" loading={making === key} disabled={making !== null} leading={<Plus />} onClick={() => void make([todo], key)}>
                    Make task
                  </Button>
                  {dismiss(key)}
                </li>
              );
            })}
          </ul>
          {already.length > 0 && (
            <p className="mt-1 pl-6 text-xs text-muted-foreground">
              Already {already.length === 1 ? "a task" : "tasks"}:{" "}
              {already.map((task, i) => (
                <span key={task.taskId}>
                  {i > 0 && ", "}
                  <Button size="sm" variant="link" className="text-xs" onClick={() => openTasksEntity({ kind: "task", id: task.taskId })}>
                    {todos.find((todo) => todo.name.toLowerCase() === task.name.toLowerCase())?.name ?? task.name}
                  </Button>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      {suggestions && open.length > 0 && <div className="my-2 border-t border-border" />}
      {suggestions && (
      <>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Sparkles className="size-3.5" /> Suggestions
      </h3>
      <ul className="mt-1.5 flex flex-col gap-0.5 text-sm text-muted-foreground">
        {template && (
          <li className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              Start from the <strong className={strong}>{template.title}</strong> template?
            </span>
            <button
              type="button"
              className={button}
              onClick={() => {
                const apply = async () => {
                  try {
                    const source = await getDoc(template.id);
                    const { content, plainText } = contentFromTemplate(
                      { id: source.id, title: source.title, icon: source.icon || "📄", content: source.content },
                      templateVars(new Date(), doc.title || source.title),
                    );
                    onApplyContent(content, plainText);
                    accept();
                    hide("template");
                  } catch {
                    useToastStore.getState().show("Could not open that template");
                  }
                };
                // Few words can still mean an image, table or embed is there.
                if (editor && !editor.isEmpty) {
                  requestConfirm({
                    title: `Replace this page with “${template.title}”?`,
                    description: "What the page holds now is replaced. Version history keeps the current copy.",
                    onConfirm: apply,
                  });
                } else void apply();
              }}
            >
              Use template
            </button>
            {dismiss("template", "template", template.id)}
          </li>
        )}
        {project && (
          <li className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              Looks like part of the <strong className={strong}>{project.title}</strong> project.
            </span>
            <button
              type="button"
              className={button}
              onClick={() => {
                updateDoc.mutate({ id: doc.id, projectId: project.id });
                accept();
                hide("project");
                showUndoToast(`Added to ${project.title}`, () => updateDoc.mutate({ id: doc.id, projectId: "" }));
              }}
            >
              Add to project
            </button>
            {dismiss("project", "project", project.id)}
          </li>
        )}
        {parent && (
          <li className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              Could live under <strong className={strong}>{parent.title}</strong>.
            </span>
            <button
              type="button"
              className={button}
              onClick={() => {
                updateDoc.mutate({ id: doc.id, parentId: parent.id });
                accept();
                hide("parent");
                showUndoToast(`Moved under ${parent.title}`, () => updateDoc.mutate({ id: doc.id, parentId: "" }));
              }}
            >
              Move
            </button>
            {dismiss("parent", "parent", parent.id)}
          </li>
        )}
        {docType && (
          <li className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              Reads like <strong className={strong}>{docTypePhrase(docType)}</strong>.
            </span>
            <button
              type="button"
              className={button}
              disabled={!editor}
              onClick={() => {
                if (!editor) return;
                setDocProperty(editor, "type", docType);
                accept();
                hide("type");
              }}
            >
              Set type
            </button>
            {dismiss("type", "type", docType)}
          </li>
        )}
        {properties.map((p) => (
          <li key={p.key} className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              Set <strong className={strong}>{p.key}</strong> to <strong className={strong}>{p.value}</strong>, as in your other docs?
            </span>
            <button
              type="button"
              className={button}
              disabled={!editor}
              onClick={() => {
                if (!editor) return;
                setDocProperty(editor, p.key, p.value);
                accept();
                hide(`prop:${p.key}`);
              }}
            >
              Set
            </button>
            {dismiss(`prop:${p.key}`, "prop", `${p.key}=${p.value}`)}
          </li>
        ))}
        {work.map((line) => (
          <li key={line} className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">
              <strong className={strong}>{line}</strong> reads like a task.
            </span>
            <button
              type="button"
              className={`${button} inline-flex items-center gap-1`}
              onClick={() => {
                createTask.mutate(
                  { name: line, kind: "task", duration: 30, workspaceId: doc.workspaceId, projectId: doc.projectId ?? undefined },
                  {
                    onSuccess: () => useToastStore.getState().show(`Task added: ${line}`),
                    // Read again, so a reopened doc does not offer the line it made.
                    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["doc-hints", doc.id] }),
                  },
                );
                accept();
                hide(`work:${line}`);
              }}
            >
              <Plus className="size-3" /> Create task
            </button>
            {dismiss(`work:${line}`, "work", line)}
          </li>
        ))}
        {outdated && (
          <li className="flex items-center gap-2 rounded-md px-1 py-1">
            <span className="min-w-0 flex-1">This doc may be out of date. It has not been edited in a while and talks about plans or dates that have likely passed.</span>
            {dismiss("outdated", "outdated")}
          </li>
        )}
      </ul>
      </>
      )}
    </section>
  );
}
