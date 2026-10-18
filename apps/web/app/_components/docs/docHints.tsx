"use client";

import { docTypePhrase } from "@timely/contract/documents";
import { checklistTask, docWorkLines, draftChecklistTasks, openChecklistItems, workLineKey, workLineTask, type ChecklistTodo } from "@timely/contract/docChecklist";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, FolderKanban, ListTodo, Plus, Sparkles, X } from "lucide-react";
import { contentFromTemplate, templateVars } from "@timely/contract/templates";
import type { Doc, Task } from "@/app/_types/types";
import Button from "@/app/_components/_ui/button";
import { getDoc } from "@/app/utils/api/docs";
import { checklistTaskDrafts } from "@/app/utils/api/write";
import { readyProviders } from "@/app/_components/chat/modelMenu";
import { useAgentProviders } from "@/app/utils/hooks/agentProviders";
import { useDecisionFeedback, useDismissDocHint, useDocChecklist, useDocHints } from "@/app/utils/hooks/decisions";
import type { DocHintKind } from "@/app/utils/api/decisions";
import { useUpdateDoc } from "@/app/utils/hooks/docs";
import { useRelated } from "@/app/utils/hooks/search";
import { openTasksEntity } from "@/app/utils/entityDetail";
import { useCreateTask, useDeleteTask } from "@/app/utils/hooks/tasks";
import { setDocProperty } from "@/app/_components/editor/frontmatter";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { requestConfirm } from "@/app/_store/confirmStore";

/** Checklist rows listed before "Show N more", so a long checklist does not
 * push the doc itself out of view. */
const TODOS_SHOWN = 4;

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
  layout = "card",
}: {
  doc: Doc;
  editor: Editor | null;
  version: string;
  /** A template is only offered while the page is still near-empty. */
  nearEmpty: boolean;
  onApplyContent: (content: Doc["content"], plainText: string) => void;
  /** "card": one card above the text; "margin": the right margin of a wide
   * page, each suggestion level with its line. */
  layout?: "card" | "margin";
}) {
  const live = !doc.isTemplate && !doc.archivedAt;
  const { data } = useDocHints(doc.id, version, live);
  const updateDoc = useUpdateDoc();
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const queryClient = useQueryClient();
  const feedback = useDecisionFeedback();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);
  const [making, setMaking] = useState<string | null>(null);
  const [showAllTodos, setShowAllTodos] = useState(false);
  // With an AI provider set up (Settings → Agent keys), Make task first asks
  // its default model for a clean title and a brief description.
  const aiReady = readyProviders(useAgentProviders().data).length > 0;

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
  // Checklists Jev reads as kept in the doc (groceries, packing) offer no tasks.
  const kept = data?.available ? data.keptLists : undefined;
  const todos = useMemo(() => (live ? openChecklistItems(content, kept) : []), [content, live, kept]);
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
  const dismissHint = useDismissDocHint(doc.id);
  // A dismissed suggestion is remembered for the doc, on every device; a
  // checklist item (no kind) only for now, as it is still a to-do.
  const forget = (key: string, kind?: DocHintKind, value = "") => {
    hide(key);
    if (kind) dismissHint.mutate({ kind, value });
  };
  const make = async (list: ChecklistTodo[], key: string) => {
    setMaking(key);
    // One request for all the items, a few seconds at most; without a
    // provider, or on any error, the tasks keep the items' own words.
    const drafts = aiReady ? await draftChecklistTasks(list, doc, checklistTaskDrafts) : list.map(() => null);
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

  const dismiss = (key: string, kind?: DocHintKind, value = "") => (
    <button
      type="button"
      aria-label="Dismiss"
      onClick={() => forget(key, kind, value)}
      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  );
  const button = "shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50";
  const strong = "font-medium text-foreground";
  const makeWork = (line: string) => {
    createTask.mutate(
      { ...workLineTask(line, doc), kind: "task", duration: 30, workspaceId: doc.workspaceId, projectId: doc.projectId ?? undefined },
      {
        onSuccess: () => {
          useToastStore.getState().show(`Task added: ${line}`);
          // Kept for the doc, so the line is not offered again once it or
          // the task is reworded; this reads the suggestions again too.
          dismissHint.mutate({ kind: "work", value: line });
        },
      },
    );
    accept();
    hide(`work:${line}`);
  };

  // Rows about the doc as a whole: they have no line to sit beside.
  const docRows = (
    <>
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
    </>
  );
  const workRow = (line: string) => (
    <li key={line} className="flex items-center gap-2 rounded-md px-1 py-1">
      <span className="min-w-0 flex-1">
        <strong className={strong}>{line}</strong> reads like a task.
      </span>
      <button type="button" className={`${button} inline-flex items-center gap-1`} onClick={() => makeWork(line)}>
        <Plus className="size-3" /> Create task
      </button>
      {dismiss(`work:${line}`, "work", line)}
    </li>
  );
  const outdatedRow = outdated && (
    <li className="flex items-center gap-2 rounded-md px-1 py-1">
      <span className="min-w-0 flex-1">This doc may be out of date. It has not been edited in a while and talks about plans or dates that have likely passed.</span>
      {dismiss("outdated", "outdated")}
    </li>
  );
  const makeAllLabel = aiReady && making === "all" ? "Writing titles…" : open.length === 1 ? "Make task" : "Make all";

  if (layout === "margin") {
    return (
      <MarginHints
        editor={editor}
        open={open}
        already={already.map((task) => ({
          taskId: task.taskId,
          name: todos.find((todo) => todo.name.toLowerCase() === task.name.toLowerCase())?.name ?? task.name,
        }))}
        work={work}
        target={target?.title}
        making={making}
        aiReady={aiReady}
        onMake={(todo) => void make([todo], `todo:${todo.name.toLowerCase()}`)}
        onMakeWork={makeWork}
        onDismiss={(key) => (key.startsWith("work:") ? forget(key, "work", key.slice("work:".length)) : hide(key))}
        summary={
          open.length > 0 && (
            <div className="flex items-center gap-2.5" data-testid="doc-checklist-tasks">
              <ListTodo className="size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium text-foreground">
                  {open.length === 1 ? "1 item isn’t a task yet" : `${open.length} items aren’t tasks yet`}
                </h3>
                {target && (
                  <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    Goes to <span className="truncate font-medium text-foreground">{target.title}</span>
                  </p>
                )}
              </div>
              <Button size="sm" variant="primary" loading={making === "all"} disabled={making !== null} onClick={() => void make(open, "all")}>
                {makeAllLabel}
              </Button>
            </div>
          )
        }
        docRows={(template || project || parent || docType || properties.length > 0 || outdated) && (
          <>
            {docRows}
            {outdatedRow}
          </>
        )}
        workRow={workRow}
      />
    );
  }

  return (
    <section className="@container mb-4 rounded-xl border border-border bg-card p-3" data-testid="doc-hints" aria-label="Doc suggestions">
      {open.length > 0 && (
        <div data-testid="doc-checklist-tasks">
          <div className="flex items-start gap-2">
            <ListTodo className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-foreground">
                {open.length === 1 ? "1 checklist item isn’t a task yet" : `${open.length} checklist items aren’t tasks yet`}
              </h3>
              {target && (
                <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  Goes to <FolderKanban className="size-3.5 shrink-0" /> <span className="truncate font-medium text-foreground">{target.title}</span>
                </p>
              )}
            </div>
            {open.length > 1 && (
              <Button size="sm" variant="soft" className="@max-lg:hidden" loading={making === "all"} disabled={making !== null} leading={<Plus />} onClick={() => void make(open, "all")}>
                {aiReady && making === "all" ? "Writing titles…" : `Make ${open.length} tasks`}
              </Button>
            )}
          </div>
          {open.length > 1 && (
            <Button size="sm" variant="soft" className="mt-2 w-full @lg:hidden" loading={making === "all"} disabled={making !== null} leading={<Plus />} onClick={() => void make(open, "all")}>
              Make {open.length} tasks
            </Button>
          )}
          <ul className="mt-1.5 flex flex-col gap-0.5 text-sm text-muted-foreground">
            {(showAllTodos ? open : open.slice(0, TODOS_SHOWN)).map((todo) => {
              const key = `todo:${todo.name.toLowerCase()}`;
              return (
                <li key={key} className="flex items-center gap-2 rounded-md py-1 pl-6 pr-1">
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 font-medium text-foreground" title={todo.text}>{todo.name}</span>
                    {todo.details && <span className="block truncate text-xs">{todo.details}</span>}
                  </span>
                  {/* Icon only in a narrow card, so the item's own words keep the room. */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="@max-lg:w-7 @max-lg:px-0"
                    title="Make task"
                    aria-label={`Make task: ${todo.name}`}
                    loading={making === key}
                    disabled={making !== null}
                    leading={<Plus />}
                    onClick={() => void make([todo], key)}
                  >
                    <span className="@max-lg:hidden">{aiReady && making === key ? "Writing…" : "Make task"}</span>
                  </Button>
                  {dismiss(key)}
                </li>
              );
            })}
          </ul>
          {open.length > TODOS_SHOWN && (
            <Button size="sm" variant="ghost" className="ml-4 text-xs" aria-expanded={showAllTodos} onClick={() => setShowAllTodos((all) => !all)}>
              {showAllTodos ? "Show fewer" : `Show ${open.length - TODOS_SHOWN} more`}
            </Button>
          )}
          {already.length > 0 && (
            <div className="mt-1 pl-6 text-xs text-muted-foreground">
              Already {already.length === 1 ? "a task" : "tasks"}:
              {/* One per line, so long names don't wrap mid-list. */}
              <ul className="mt-0.5 flex flex-col items-start gap-0.5">
                {already.map((task) => (
                  <li key={task.taskId} className="flex max-w-full">
                    <Button size="sm" variant="link" className="max-w-full text-xs" onClick={() => openTasksEntity({ kind: "task", id: task.taskId })}>
                      <span className="truncate">
                        {todos.find((todo) => todo.name.toLowerCase() === task.name.toLowerCase())?.name ?? task.name}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
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
            {docRows}
            {work.map(workRow)}
            {outdatedRow}
          </ul>
        </>
      )}
    </section>
  );
}

/** A suggestion that belongs to one line of the doc. */
type LineHint =
  | { key: string; kind: "todo"; todo: ChecklistTodo }
  | { key: string; kind: "task"; name: string; taskId: string }
  | { key: string; kind: "work"; line: string };

/** The node the open or hovered margin card is about, marked in the doc with
 * a decoration (a class set on the node's element by hand would be undone the
 * next time ProseMirror redraws it). */
type Marked = { from: number; to: number } | null;
const hintMarkKey = new PluginKey<Marked>("docHintMark");
const hintMarkPlugin = new Plugin<Marked>({
  key: hintMarkKey,
  state: {
    init: () => null,
    apply: (tr, value) => {
      const next = tr.getMeta(hintMarkKey) as Marked | undefined;
      if (next !== undefined) return next;
      if (!value || !tr.docChanged) return value;
      const from = tr.mapping.mapResult(value.from, 1);
      const to = tr.mapping.mapResult(value.to, -1);
      return from.deleted || to.deleted || to.pos <= from.pos ? null : { from: from.pos, to: to.pos };
    },
  },
  props: {
    decorations: (state) => {
      const mark = hintMarkKey.getState(state);
      const node = mark && state.doc.nodeAt(mark.from);
      if (!mark || !node || mark.from + node.nodeSize !== mark.to) return null;
      return DecorationSet.create(state.doc, [Decoration.node(mark.from, mark.to, { class: "doc-line-hinted" })]);
    },
  },
});

/** Where a hint's line is: its position in the doc and its element. */
type LineSpot = { pos: number; end: number; el: HTMLElement };

/** Finds the line each hint is about in the open editor: the checklist row
 * with the same item (read the way `openChecklistItems` reads it), or for a
 * "reads like a task" line the first block holding those words. */
function findLines(editor: Editor, hints: LineHint[]): Map<string, LineSpot> {
  const rows = new Map<string, { pos: number; end: number }>();
  const blocks: { pos: number; end: number; text: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "taskItem") {
      const [item] = openChecklistItems({ type: "doc", content: [node.toJSON()] });
      const key = item?.name.toLowerCase();
      if (key && !rows.has(key)) rows.set(key, { pos, end: pos + node.nodeSize });
    }
    if (node.isTextblock) blocks.push({ pos, end: pos + node.nodeSize, text: node.textContent });
    return true;
  });
  const spots = new Map<string, LineSpot>();
  for (const hint of hints) {
    let found: { pos: number; end: number } | undefined;
    if (hint.kind === "work") {
      const words = hint.line.trim().toLowerCase();
      found = blocks.find((block) => block.text.toLowerCase().includes(words));
    } else {
      found = rows.get((hint.kind === "todo" ? hint.todo.name : hint.name).toLowerCase());
    }
    const el = found ? editor.view.nodeDOM(found.pos) : null;
    // A row inside a closed toggle has no box to sit beside.
    if (found && el instanceof HTMLElement && el.getClientRects().length > 0) spots.set(hint.key, { ...found, el });
  }
  return spots;
}

/** The suggestions in the right margin of a wide doc page: a summary card at
 * the top, then a card level with each line it is about, as comments sit in
 * a word processor. Cards are one quiet line until their line holds the
 * cursor or the card is opened; one that would overlap the card above moves
 * down, and its dot stays level with its line. */
function MarginHints({
  editor,
  open,
  already,
  work,
  target,
  making,
  aiReady,
  onMake,
  onMakeWork,
  onDismiss,
  summary,
  docRows,
  workRow,
}: {
  editor: Editor | null;
  open: ChecklistTodo[];
  already: { taskId: string; name: string }[];
  work: string[];
  target?: string;
  making: string | null;
  aiReady: boolean;
  onMake: (todo: ChecklistTodo) => void;
  onMakeWork: (line: string) => void;
  onDismiss: (key: string) => void;
  summary: ReactNode;
  docRows: ReactNode;
  workRow: (line: string) => ReactNode;
}) {
  // The parent rebuilds these lists on every render; the hints only change
  // when what they say does.
  const signature = JSON.stringify([open, already, work]);
  const hints = useMemo<LineHint[]>(() => {
    const [todos, tasks, lines] = JSON.parse(signature) as [ChecklistTodo[], { taskId: string; name: string }[], string[]];
    return [
      ...todos.map((todo) => ({ key: `todo:${todo.name.toLowerCase()}`, kind: "todo" as const, todo })),
      ...tasks.map((task) => ({ key: `task:${task.taskId}`, kind: "task" as const, name: task.name, taskId: task.taskId })),
      ...lines.map((line) => ({ key: `work:${line}`, kind: "work" as const, line })),
    ];
  }, [signature]);
  const [spots, setSpots] = useState<Map<string, LineSpot>>(new Map());
  const [active, setActive] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const dots = useRef(new Map<string, HTMLElement>());

  // Lines move as the doc is edited, so they are found again after each
  // change, and the hint whose line holds the cursor opens.
  useEffect(() => {
    if (!editor) return;
    const locate = () => {
      if (editor.isDestroyed) return;
      const next = findLines(editor, hints);
      setSpots(next);
      const head = editor.state.selection.head;
      const here = [...next].find(([, spot]) => head > spot.pos && head < spot.end);
      setActive((current) => (here ? here[0] : editor.isFocused ? null : current));
    };
    locate();
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(locate);
    };
    editor.on("update", soon);
    editor.on("selectionUpdate", soon);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("update", soon);
      editor.off("selectionUpdate", soon);
    };
  }, [editor, hints]);

  const placed = hints.filter((hint) => spots.has(hint.key)).sort((a, b) => spots.get(a.key)!.pos - spots.get(b.key)!.pos);
  const unplaced = hints.filter((hint) => !spots.has(hint.key));

  // Sets each card's top: level with its line, the open one exactly, the
  // others pushed apart where they would overlap.
  const place = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const origin = root.getBoundingClientRect().top;
    const floor = headRef.current ? headRef.current.offsetTop + headRef.current.offsetHeight + 12 : 0;
    const gap = 6;
    const items = placed.flatMap((hint) => {
      const card = cards.current.get(hint.key);
      const spot = spots.get(hint.key);
      if (!card || !spot?.el.isConnected) return [];
      const line = spot.el.getBoundingClientRect();
      const lineHeight = Math.min(line.height, 24);
      return [{ key: hint.key, card, want: line.top - origin - 2, mid: line.top - origin + lineHeight / 2, height: card.offsetHeight, top: 0 }];
    });
    // Closed cards sit level with their lines, moved down only where two
    // would overlap. The open card sits level with its own line on top of
    // them; the closed cards it covers step out of the way until it closes.
    const pinned = items.find((item) => item.key === active);
    if (pinned) pinned.top = Math.max(pinned.want, floor);
    let bottom = floor;
    for (const item of items) {
      if (item === pinned) continue;
      item.top = Math.max(item.want, bottom);
      bottom = item.top + item.height + gap;
    }
    for (const item of items) {
      const covered = pinned && item !== pinned && item.top < pinned.top + pinned.height && item.top + item.height > pinned.top;
      item.card.style.top = `${item.top}px`;
      item.card.style.visibility = covered ? "hidden" : "visible";
      const dot = dots.current.get(item.key);
      if (dot) dot.style.top = `${item.mid - 3}px`;
    }
    if (pinned) bottom = Math.max(bottom, pinned.top + pinned.height + gap);
    root.style.minHeight = `${bottom}px`;
  }, [placed, spots, active]);

  useLayoutEffect(place);
  const placeRef = useRef(place);
  useLayoutEffect(() => {
    placeRef.current = place;
  });
  useEffect(() => {
    const root = rootRef.current;
    if (!editor || !root) return;
    // Images loading, the window resizing and wrapped lines all move lines.
    const observer = new ResizeObserver(() => placeRef.current());
    observer.observe(editor.view.dom);
    observer.observe(root);
    return () => observer.disconnect();
  }, [editor]);

  // The line of the card under the pointer, or the open one, is marked.
  const marked = hovered ?? active;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.registerPlugin(hintMarkPlugin);
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(hintMarkKey);
    };
  }, [editor]);
  const markedSpot = marked ? spots.get(marked) : undefined;
  const markFrom = markedSpot?.pos;
  const markTo = markedSpot?.end;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const mark: Marked = markFrom !== undefined && markTo !== undefined ? { from: markFrom, to: markTo } : null;
    const current = hintMarkKey.getState(editor.state);
    if (current?.from === mark?.from && current?.to === mark?.to) return;
    editor.view.dispatch(editor.state.tr.setMeta(hintMarkKey, mark).setMeta("addToHistory", false));
  }, [editor, markFrom, markTo]);

  const goTo = (key: string) => {
    const spot = spots.get(key);
    if (!editor || !spot) return;
    setActive(key);
    spot.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const card = (hint: LineHint) => {
    const isOpen = hint.key === active;
    const busy = making === hint.key;
    const shell = `w-full rounded-xl border text-sm transition-colors ${
      isOpen ? "border-primary/35 bg-card p-3 shadow-lg" : "border-transparent px-2 py-0.5 hover:border-border hover:bg-card"
    }`;
    if (hint.kind === "task") {
      return (
        <div className={`${shell} ${isOpen ? "" : "flex h-7 items-center"}`}>
          <Button size="sm" variant="link" className="max-w-full text-xs text-muted-foreground" onClick={() => openTasksEntity({ kind: "task", id: hint.taskId })}>
            <Check /> Already a task <ArrowUpRight />
          </Button>
        </div>
      );
    }
    const name = hint.kind === "todo" ? hint.todo.name : hint.line;
    const make = () => (hint.kind === "todo" ? onMake(hint.todo) : onMakeWork(hint.line));
    if (!isOpen) {
      // The line itself is right beside the card, so a closed card only offers the action.
      return (
        <div className={`${shell} group flex h-7 items-center gap-1`}>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs group-hover:text-primary"
            leading={<Plus />}
            aria-label={`Make task: ${name}`}
            loading={busy}
            disabled={making !== null}
            onClick={make}
          >
            {aiReady && busy ? "Writing…" : "Make task"}
          </Button>
          <button
            type="button"
            onClick={() => goTo(hint.key)}
            aria-label={`More about: ${name}`}
            className="h-6 min-w-0 flex-1 rounded-md"
          />
          <button
            type="button"
            aria-label={`Dismiss: ${name}`}
            onClick={() => onDismiss(hint.key)}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
      );
    }
    return (
      <div className={shell}>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="size-3" />
          {hint.kind === "todo" ? "Checklist item" : "Reads like a task"}
          <span className="flex-1" />
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => onDismiss(hint.key)}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <p className="mt-1.5 line-clamp-3 font-medium text-foreground">{name}</p>
        {hint.kind === "todo" && hint.todo.details && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hint.todo.details}</p>}
        <div className="mt-2.5 flex items-center gap-2">
          {target && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <FolderKanban className="size-3.5 shrink-0" />
              <span className="truncate">{target}</span>
            </span>
          )}
          <span className="flex-1" />
          <Button size="sm" variant="primary" leading={<Plus />} loading={busy} disabled={making !== null} onClick={make}>
            {aiReady && busy ? "Writing…" : "Make task"}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div ref={rootRef} className="relative" data-testid="doc-hints" aria-label="Doc suggestions">
      {(summary || docRows || unplaced.length > 0) && (
      <div ref={headRef} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
        {summary}
        {(docRows || unplaced.length > 0) && (
          <ul className={`flex flex-col gap-0.5 text-sm text-muted-foreground ${summary ? "border-t border-border pt-2" : ""}`}>
            {docRows}
            {unplaced.map((hint) =>
              hint.kind === "work" ? (
                workRow(hint.line)
              ) : hint.kind === "todo" ? (
                <li key={hint.key} className="flex items-center gap-2 rounded-md px-1 py-1">
                  <span className="min-w-0 flex-1 truncate text-foreground" title={hint.todo.text}>{hint.todo.name}</span>
                  <Button size="sm" variant="outline" loading={making === hint.key} disabled={making !== null} onClick={() => onMake(hint.todo)}>
                    Make task
                  </Button>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </div>
      )}
      {placed.map((hint) => (
        <div key={hint.key}>
          <span
            ref={(el) => {
              if (el) dots.current.set(hint.key, el);
              else dots.current.delete(hint.key);
            }}
            aria-hidden="true"
            className={`absolute -left-[1.4rem] size-1.5 rounded-full transition-colors ${hint.key === marked ? "bg-primary" : "bg-muted-foreground/40"}`}
          />
          <div
            ref={(el) => {
              if (el) cards.current.set(hint.key, el);
              else cards.current.delete(hint.key);
            }}
            // Placed by `place`; hidden until then so it does not flash at the top.
            style={{ visibility: "hidden" }}
            className={`absolute inset-x-0 ${hint.key === active ? "z-10" : ""}`}
            onMouseEnter={() => setHovered(hint.key)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(hint.key)}
            onBlur={() => setHovered(null)}
          >
            {card(hint)}
          </div>
        </div>
      ))}
    </div>
  );
}
