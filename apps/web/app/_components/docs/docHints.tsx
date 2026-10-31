"use client";

import { checklistTask, docWorkLines, draftChecklistTasks, openChecklistItems, workLineKey, workLineTask, type ChecklistTodo } from "@timely/contract/docChecklist";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ListTodo, Plus, Sparkles, X } from "lucide-react";
import { contentFromTemplate, templateVars } from "@timely/contract/templates";
import type { Doc, Task } from "@/app/_types/types";
import Button from "@/app/_components/_ui/button";
import { ListSwitch } from "@/app/_components/_ui/groupedList";
import { RailRow, RailRows, RailSection } from "@/app/_components/_ui/pageWithRail";
import OfferPopover from "@/app/_components/docs/offerPopover";
import { currentOffers, offerInline, offerMarks, offerMarksKey, offerPlaces, offerSpot, setOffers, type Offer, type OfferConfig } from "@/app/_components/editor/offerMarks";
import { getDoc } from "@/app/utils/api/docs";
import { checklistTaskDrafts } from "@/app/utils/api/write";
import { readyProviders } from "@/app/_components/chat/modelMenu";
import { useAgentProviders } from "@/app/utils/hooks/agentProviders";
import { useDecisionFeedback, useDismissDocHint, useDocChecklist, useDocHints, useDocOffersOff } from "@/app/utils/hooks/decisions";
import type { DocHintKind } from "@/app/utils/api/decisions";
import { useUpdateDoc } from "@/app/utils/hooks/docs";
import { useProject } from "@/app/utils/hooks/projects";
import { useRelated } from "@/app/utils/hooks/search";
import { openTasksEntity } from "@/app/utils/entityDetail";
import { useCreateTask, useDeleteTask } from "@/app/utils/hooks/tasks";
import { setDocProperty } from "@/app/_components/editor/frontmatter";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { requestConfirm } from "@/app/_store/confirmStore";
import { cn } from "@/app/utils/cn";

/** Rows of "Not tasks yet" listed before "Show N more", so a long checklist
 * does not push the rest of the rail out of view. */
const ROWS_SHOWN = 5;

/** Checklist offers answered so far, by decision: one answer each. */
const answered = new Set<string>();

/** A line of the doc offered as a task, as the "Not tasks yet" card lists it. */
type OfferRow = { key: string; name: string; section: string } & ({ kind: "todo"; todo: ChecklistTodo } | { kind: "work"; line: string });

/** What smart suggestions read in a doc: a template for a near-empty page,
 * the project or page it may belong under, its type and properties, lines
 * that read like something to do, and whether it looks out of date. With
 * them, the doc's unchecked checklist items that Jev reads as things to get
 * done and are not tasks yet. Each offered line gets a disc on its row
 * (offerMarks.ts) that opens the offer there, and a row in the "Not tasks
 * yet" card; every offer can be dismissed, and the checklist offers turned
 * off for the doc. */
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
  /** "card": one card above the text, offers opening under their rows;
   * "margin": cards in the rail beside a wide page, offers opening beside
   * their rows. */
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
  const [showAll, setShowAll] = useState(false);
  // A narrow page's card lists the offers once opened.
  const [rowsShown, setRowsShown] = useState(false);
  // The offer whose popover is open, and the ones whose doc row and rail
  // row are under the pointer. The two hovers are kept apart: the doc's
  // leave comes a moment late, and must not clear a rail row entered since.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [docHover, setDocHover] = useState<string | null>(null);
  const [railHover, setRailHover] = useState<string | null>(null);
  const hovered = railHover ?? docHover;
  // What the popover focuses as it opens (a step keeps focus on its arrow),
  // and what had focus before it opened, to go back to as it closes.
  const [focusOn, setFocusOn] = useState<"dialog" | "prev" | "next" | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openRef = useRef<string | null>(null);
  // With an AI provider set up (Settings → Agent keys), Make task first asks
  // its default model for a clean title and a brief description.
  const aiReady = readyProviders(useAgentProviders().data).length > 0;
  const hasChecklist = useHasChecklist(editor);

  // The checklist is read from the open editor, a moment after typing stops,
  // so a ticked or deleted item leaves at once and a new one shows up.
  const [content, setContent] = useState(() => editor?.getJSON() ?? doc.content);
  useEffect(() => {
    if (!editor) return;
    let timer = setTimeout(() => setContent(editor.getJSON()));
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
  // A checklist item's task goes to the doc's project, else the one
  // suggestions place the doc in, else the project it is most related to;
  // the server checks the pick.
  const related = useRelated("doc", doc.id).data;
  const proposed = doc.projectId || data?.project?.id || related?.find((item) => item.kind === "project")?.id;
  const checklist = useDocChecklist(doc.id, names, proposed ?? undefined);
  const target = checklist.data?.project;
  // A line that reads like a task goes to the doc's own project only, as on
  // the phone. The card, the popover and the message name what make() sends.
  const docProject = useProject(doc.projectId || undefined).data;
  const goesTo = (kind: "todo" | "work") => (kind === "todo" ? target?.title : doc.projectId && docProject?.id === doc.projectId ? docProject.title : undefined);
  const taken = new Set((checklist.data?.existing ?? []).map((task) => task.name.toLowerCase()));
  const checked = new Set((checklist.data?.names ?? []).map((name) => name.toLowerCase()));
  // Offered only while smart suggestions are on, and only the items Jev reads
  // as things to get done (a call, an errand), not ones kept in the doc to
  // tick off there (milk, an ingredient).
  const offered = new Set((checklist.data?.offer ?? []).map((name) => name.toLowerCase()));
  const offersAreOff = useDocOffersOff(doc.id, checklist.data?.off ?? data?.todosOff);
  const todoOffers = offersAreOff
    ? []
    : todos.filter((todo) => {
        const key = todo.name.toLowerCase();
        return offered.has(key) && checked.has(key) && !taken.has(key) && !hidden.has(`todo:${key}`);
      });
  // Items that are tasks already get a check on their row that opens the
  // task, so it is clear why they are not offered.
  const already = (checklist.data?.existing ?? []).flatMap((task) => {
    const todo = todos.find((item) => item.name.toLowerCase() === task.name.toLowerCase());
    return todo ? [{ taskId: task.taskId, name: todo.name }] : [];
  });

  const hints = data?.available ? data : undefined;
  const template = hints?.template && nearEmpty && !hidden.has("template") ? hints.template : undefined;
  const project = hints?.project && !doc.projectId && !hidden.has("project") ? hints.project : undefined;
  const parent = hints?.parent && !doc.parentId && !hidden.has("parent") ? hints.parent : undefined;
  const docType = hints?.docType && !hidden.has("type") ? hints.docType : undefined;
  const properties = (hints?.properties ?? []).filter((p) => !hidden.has(`prop:${p.key}`));
  const work = (hints?.work ?? []).filter((line) => !hidden.has(`work:${line}`) && lines.has(workLineKey(line)));
  const outdated = Boolean(hints?.outdated && !hidden.has("outdated"));

  // The rows the plugin draws a disc on: offers, then rows that are tasks already.
  const offers: Offer[] = [
    ...todoOffers.map((todo) => ({ key: `todo:${todo.name.toLowerCase()}`, kind: "todo" as const, name: todo.name })),
    ...work.map((line) => ({ key: `work:${line}`, kind: "work" as const, name: line })),
    ...already.map((task) => ({ key: `task:${task.taskId}`, kind: "task" as const, name: task.name })),
  ];
  const offersKey = JSON.stringify(offers);

  // The offers whose rows are in the doc, in reading order under the
  // nearest heading: what the card lists and counts, and what Make all makes.
  const places = editor && !editor.isDestroyed ? offerPlaces(editor.state, offers.filter((offer) => offer.kind !== "task")) : [];
  const rows = places.flatMap(({ key, section }): OfferRow[] => {
    const todo = todoOffers.find((item) => `todo:${item.name.toLowerCase()}` === key);
    if (todo) return [{ key, name: todo.name, section, kind: "todo" as const, todo }];
    const line = work.find((item) => `work:${item}` === key);
    return line ? [{ key, name: line, section, kind: "work" as const, line }] : [];
  });
  // A made or dismissed offer's popover closes with it.
  const shownKey = openKey && rows.some((row) => row.key === openKey) ? openKey : null;
  const hotKey = hovered && offers.some((offer) => offer.key === hovered) ? hovered : null;
  useEffect(() => {
    openRef.current = shownKey;
  }, [shownKey]);

  // The plugin that draws the discs, with what they do.
  const marks = useMemo(
    () =>
      offerMarks(() => ({
        toggle: (key, keyboard) => {
          if (openRef.current !== key) {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setFocusOn(keyboard ? "dialog" : null);
          }
          setOpenKey((current) => (current === key ? null : key));
        },
        openTask: (key) => openTasksEntity({ kind: "task", id: key.slice("task:".length) }),
        hover: setDocHover,
      })),
    [],
  );
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.registerPlugin(marks.plugin);
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(offerMarksKey);
    };
  }, [editor, marks]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = currentOffers(editor.state);
    if (!current) return;
    const config: OfferConfig = { offers: JSON.parse(offersKey) as Offer[], open: shownKey, hover: hotKey, busy: making, inline: layout === "card" };
    if (JSON.stringify(current) === JSON.stringify(config)) return;
    editor.view.dispatch(setOffers(editor.state, config, editor.isFocused));
  }, [editor, offersKey, shownKey, hotKey, making, layout]);
  // The element the open offer renders into, drawn by the plugin: the disc's
  // own host for a popover, or the card's under the row where the disc sits
  // inside the text.
  useSyncExternalStore(marks.hosts.subscribe, marks.hosts.version, () => 0);
  const inlineOffer = layout === "card" || Boolean(shownKey && editor && !editor.isDestroyed && offerInline(editor.state, shownKey));
  const host = shownKey ? marks.hosts.get(inlineOffer ? `card:${shownKey}` : shownKey) : undefined;

  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));
  const unhide = (keys: string[]) =>
    setHidden((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.delete(key);
      return next;
    });
  const dismissHint = useDismissDocHint(doc.id);
  // A dismissed suggestion is remembered for the doc, on every device.
  const forget = (key: string, kind: DocHintKind, value = "") => {
    hide(key);
    dismissHint.mutate({ kind, value });
  };
  // Tells Jev whether its checklist offers were wanted: a task made from one,
  // or one dismissed.
  const answerOffers = (accepted: boolean) => {
    const logId = checklist.data?.logId;
    if (!logId || answered.has(logId)) return;
    answered.add(logId);
    feedback.mutate({ logId, accepted });
  };
  const dropTodo = (name: string) => {
    forget(`todo:${name.toLowerCase()}`, "todo", name);
    answerOffers(false);
  };
  // Turned off for this doc on every device; the switch in the card, the
  // chip under a narrow page's title, or the undo here turns them back on.
  const offersOff = () => {
    const logId = checklist.data?.logId;
    // The same offers come back if this is not saved or is undone, so a task
    // made from one can still say so.
    const offersBack = () => {
      if (logId) answered.delete(logId);
    };
    dismissHint.mutate({ kind: "todos" }, { onError: offersBack });
    answerOffers(false);
    showUndoToast("Tasks won’t be offered from this doc’s checklists", () => {
      offersBack();
      dismissHint.mutate({ kind: "todos", restore: true });
    });
  };
  const accept = () => {
    if (data?.logId && !sent) {
      setSent(true);
      feedback.mutate({ logId: data.logId, accepted: true });
    }
  };
  // Makes tasks from checklist items and lines that read like a task, with
  // one message whose undo takes them all back.
  const make = async (items: ChecklistTodo[], workLines: string[], key: string) => {
    setMaking(key);
    if (items.length) answerOffers(true);
    if (workLines.length) accept();
    // One request for all the items, a few seconds at most; without a
    // provider, or on any error, the tasks keep the items' own words.
    const drafts = aiReady && items.length ? await draftChecklistTasks(items, doc, checklistTaskDrafts) : items.map(() => null);
    const made: Task[] = [];
    // The offer's key each task came from; the name may differ.
    const from = new Map<string, string>();
    const madeLines: string[] = [];
    // Where each made task went, for the message.
    const places = new Set<string | undefined>();
    for (const [i, todo] of items.entries()) {
      try {
        const task = await createTask.mutateAsync({
          ...checklistTask(todo, doc, drafts[i]),
          kind: "task",
          duration: 30,
          workspaceId: target?.workspaceId ?? doc.workspaceId,
          projectId: target?.id,
        });
        places.add(goesTo("todo"));
        made.push(task);
        from.set(task.id, `todo:${todo.name.toLowerCase()}`);
        hide(`todo:${todo.name.toLowerCase()}`);
      } catch {
        // Reported below with the count.
      }
    }
    for (const line of workLines) {
      try {
        const task = await createTask.mutateAsync({ ...workLineTask(line, doc), kind: "task", duration: 30, workspaceId: doc.workspaceId, projectId: doc.projectId || undefined });
        places.add(goesTo("work"));
        made.push(task);
        from.set(task.id, `work:${line}`);
        madeLines.push(line);
        hide(`work:${line}`);
        // Kept for the doc, so the line is not offered again once it or the
        // task is reworded; this reads the suggestions again too.
        dismissHint.mutate({ kind: "work", value: line });
      } catch {
        // Reported below with the count.
      }
    }
    setMaking(null);
    setOpenKey((current) => (current === key ? null : current));
    void queryClient.invalidateQueries({ queryKey: ["doc-checklist", doc.id] });
    const asked = items.length + workLines.length;
    if (!made.length) {
      useToastStore.getState().show("Could not add the task");
      return;
    }
    // A project is named only when every task went to it.
    const [place] = places;
    const to = places.size === 1 && place ? ` to ${place}` : "";
    const message =
      made.length === 1 ? `Task added${to}: ${made[0].name}` : `${made.length} tasks added${to}${made.length < asked ? `, ${asked - made.length} failed` : ""}`;
    showUndoToast(message, () => {
      unhide(made.map((task) => from.get(task.id) ?? `todo:${task.name.toLowerCase()}`));
      for (const line of madeLines) dismissHint.mutate({ kind: "work", value: line, restore: true });
      // Read again once the tasks are gone, or the answer still names them
      // as tasks and the items come back as tasks already.
      void Promise.allSettled(made.map((task) => deleteTask.mutateAsync(task.id))).then(() =>
        queryClient.invalidateQueries({ queryKey: ["doc-checklist", doc.id] }),
      );
    });
  };
  const makeRow = (row: OfferRow) => void (row.kind === "todo" ? make([row.todo], [], row.key) : make([], [row.line], row.key));
  const makeAll = () =>
    void make(
      rows.flatMap((row) => (row.kind === "todo" ? [row.todo] : [])),
      rows.flatMap((row) => (row.kind === "work" ? [row.line] : [])),
      "all",
    );
  const dismissRow = (row: OfferRow) => {
    setOpenKey((current) => (current === row.key ? null : current));
    if (row.kind === "todo") dropTodo(row.todo.name);
    else forget(row.key, "work", row.line);
  };
  // Scrolls the row's line to the middle of the page and opens its offer
  // there, with focus in it: on the arrow that stepped to it, else on the
  // popover itself.
  const goTo = (key: string, focus: "dialog" | "prev" | "next") => {
    const pos = editor && !editor.isDestroyed ? offerSpot(editor.state, key) : null;
    const dom = pos === null || !editor ? null : editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "center", behavior: "smooth" });
    setFocusOn(focus);
    setOpenKey(key);
  };
  const openFromRail = (key: string, button: HTMLElement) => {
    opener.current = button;
    goTo(key, "dialog");
  };
  // Once the popover has gone with focus in it (closed with Esc, made or
  // dismissed), focus goes back to what opened it, else to the text. A step
  // has put focus in the next popover by then, and keeps it.
  const restoreFocus = () =>
    queueMicrotask(() => {
      const active = document.activeElement;
      if ((active && active !== document.body) || !editor || editor.isDestroyed) return;
      const back = opener.current;
      if (back?.isConnected && back !== editor.view.dom) back.focus({ preventScroll: true });
      else editor.view.focus();
    });

  const narrow = layout === "card";
  const suggestions = Boolean(template || project || parent || docType || properties.length || outdated);
  // The switch shows in the card while it has rows, and on a wide page alone
  // while the offers are off, so they can be turned back on (a narrow page's
  // chip under the title does that there).
  const switchRow = Boolean(data?.available) && hasChecklist;
  const offersCard = rows.length > 0 || (!narrow && switchRow && offersAreOff);

  const popoverRow = shownKey ? rows.find((row) => row.key === shownKey) : undefined;
  const popoverIndex = popoverRow ? rows.indexOf(popoverRow) : -1;
  const popover =
    popoverRow && host && editor
      ? createPortal(
          <OfferPopover
            key={popoverRow.key}
            offerKey={popoverRow.key}
            kind={popoverRow.kind}
            name={popoverRow.name}
            details={popoverRow.kind === "todo" ? popoverRow.todo.details : undefined}
            target={goesTo(popoverRow.kind)}
            step={
              narrow
                ? undefined
                : {
                    index: popoverIndex,
                    total: rows.length,
                    prev: popoverIndex > 0 ? () => goTo(rows[popoverIndex - 1].key, "prev") : null,
                    next: popoverIndex < rows.length - 1 ? () => goTo(rows[popoverIndex + 1].key, "next") : null,
                  }
            }
            focus={focusOn}
            busy={making === popoverRow.key}
            writing={aiReady && making === popoverRow.key && popoverRow.kind === "todo"}
            disabled={making !== null}
            onMake={() => makeRow(popoverRow)}
            onDismiss={() => dismissRow(popoverRow)}
            onClose={() => setOpenKey(null)}
            onLeaveWithFocus={restoreFocus}
            editor={editor}
            variant={inlineOffer ? "card" : "popover"}
          />,
          host,
        )
      : null;

  if (!offersCard && !suggestions) return popover;

  const dismissButton = (label: string, onClick: () => void) => (
    <Button size="sm" variant="ghost" icon aria-label={label} title="Dismiss" onClick={onClick}>
      <X />
    </Button>
  );
  // Rows about the doc as a whole: they have no line to sit beside.
  const suggestionRows = (
    <ul className="flex flex-col">
      {template && (
        <SuggestionRow
          label="Template"
          value={template.title}
          action={
            <Button
              size="sm"
              variant="outline"
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
              Use
            </Button>
          }
          dismiss={dismissButton(`Dismiss: ${template.title} template`, () => forget("template", "template", template.id))}
        />
      )}
      {project && (
        <SuggestionRow
          label="Project"
          value={project.title}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                updateDoc.mutate({ id: doc.id, projectId: project.id });
                accept();
                hide("project");
                showUndoToast(`Added to ${project.title}`, () => updateDoc.mutate({ id: doc.id, projectId: "" }));
              }}
            >
              Add
            </Button>
          }
          dismiss={dismissButton(`Dismiss: ${project.title} project`, () => forget("project", "project", project.id))}
        />
      )}
      {parent && (
        <SuggestionRow
          label="Move under"
          value={parent.title}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                updateDoc.mutate({ id: doc.id, parentId: parent.id });
                accept();
                hide("parent");
                showUndoToast(`Moved under ${parent.title}`, () => updateDoc.mutate({ id: doc.id, parentId: "" }));
              }}
            >
              Move
            </Button>
          }
          dismiss={dismissButton(`Dismiss: move under ${parent.title}`, () => forget("parent", "parent", parent.id))}
        />
      )}
      {docType && (
        <SuggestionRow
          label="Type"
          value={docType.charAt(0).toUpperCase() + docType.slice(1)}
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={!editor}
              onClick={() => {
                if (!editor) return;
                setDocProperty(editor, "type", docType);
                accept();
                hide("type");
              }}
            >
              Set
            </Button>
          }
          dismiss={dismissButton(`Dismiss: type ${docType}`, () => forget("type", "type", docType))}
        />
      )}
      {properties.map((p) => (
        <SuggestionRow
          key={p.key}
          label={p.key}
          value={p.value}
          meta="As in your other docs"
          action={
            <Button
              size="sm"
              variant="outline"
              disabled={!editor}
              onClick={() => {
                if (!editor) return;
                setDocProperty(editor, p.key, p.value);
                accept();
                hide(`prop:${p.key}`);
              }}
            >
              Set
            </Button>
          }
          dismiss={dismissButton(`Dismiss: ${p.key}`, () => forget(`prop:${p.key}`, "prop", `${p.key}=${p.value}`))}
        />
      ))}
      {outdated && (
        <SuggestionRow
          label="May be out of date"
          meta="Not edited in a while, and it talks about plans or dates that have likely passed."
          dismiss={dismissButton("Dismiss: may be out of date", () => forget("outdated", "outdated"))}
        />
      )}
    </ul>
  );

  // Rows under the doc's own section names, in reading order. A row past
  // the first few is listed too while its popover is open or its line is
  // hovered, so the card always lights the row the doc points at.
  const listed = showAll ? rows : rows.filter((row, i) => i < ROWS_SHOWN || row.key === shownKey || row.key === hotKey);
  const groups: { section: string; rows: OfferRow[] }[] = [];
  for (const row of listed) {
    const last = groups[groups.length - 1];
    if (last && last.section === row.section) last.rows.push(row);
    else groups.push({ section: row.section, rows: [row] });
  }
  const offerList = rows.length > 0 && (
    <>
      <ul className="flex flex-col">
        {groups.map((group, g) => (
          <li key={`${g}:${group.section}`} className={g > 0 ? "mt-2" : undefined}>
            {group.section && (
              <span className="block truncate pb-0.5 text-[11px] font-semibold uppercase leading-5 tracking-[0.08em] text-muted-foreground">
                {group.section}
              </span>
            )}
            <ul className="flex flex-col">
              {group.rows.map((row, i) => {
                const busy = making === row.key;
                const isOpen = row.key === shownKey;
                return (
                  <li
                    key={row.key}
                    data-offer-trigger={row.key}
                    className={cn("min-w-0", i > 0 && "border-t border-border")}
                    onMouseEnter={() => setRailHover(row.key)}
                    onMouseLeave={() => setRailHover(null)}
                  >
                    <span
                      className={cn(
                        "group -mx-2 flex min-h-9 items-center gap-1 rounded-[10px] px-2 transition-colors",
                        isOpen ? "bg-primary/10" : row.key === hotKey && "bg-foreground/[0.06]",
                      )}
                    >
                      <button
                        type="button"
                        title={row.kind === "todo" ? row.todo.text : row.name}
                        onClick={(event) => openFromRail(row.key, event.currentTarget)}
                        className="min-w-0 flex-1 truncate py-2 text-left text-sm text-foreground"
                      >
                        {row.name}
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="-mr-2.5 group-hover:mr-0 group-focus-within:mr-0"
                        leading={<Plus className="text-primary" />}
                        aria-label={`Make task: ${row.name}`}
                        loading={busy}
                        disabled={making !== null}
                        onClick={() => makeRow(row)}
                      >
                        {aiReady && busy && row.kind === "todo" ? "Writing…" : "Make task"}
                      </Button>
                      <span className="hidden group-focus-within:flex group-hover:flex">
                        {dismissButton(`Dismiss: ${row.name}`, () => dismissRow(row))}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {(showAll ? rows.length > ROWS_SHOWN : listed.length < rows.length) && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1 w-full"
          aria-expanded={showAll}
          trailing={<ChevronDown className={cn("transition-transform", showAll && "rotate-180")} />}
          onClick={() => setShowAll((all) => !all)}
        >
          {showAll ? "Show fewer" : `Show ${rows.length - listed.length} more`}
        </Button>
      )}
    </>
  );
  // One "Goes to" row while every offer goes to the same place; otherwise
  // one for the checklist items and one for the other lines.
  const kinds = [...new Set(rows.map((row) => row.kind))];
  const mixed = kinds.length > 1 && goesTo("todo") !== goesTo("work");
  const goesToRows = (mixed ? (["todo", "work"] as const) : kinds.slice(0, 1)).map((kind) => {
    const value = goesTo(kind);
    const label = !mixed ? "Goes to" : kind === "todo" ? "Checklist items go to" : "Other lines go to";
    return <RailRow key={kind} label={label} value={value ?? "Inbox"} tone={value ? "default" : "muted"} />;
  });
  const offersFooter = (rows.length > 0 || switchRow) && (
    <RailRows className={rows.length > 0 ? "mt-2 border-t border-border" : undefined}>
      {goesToRows}
      {switchRow && (
        <RailRow
          label="Offer tasks from checklists"
          value={
            // A block, so the switch sits level with the label rather than on a text line.
            <span className="flex">
              <ListSwitch
                checked={!offersAreOff}
                label="Offer tasks from checklists"
                onChange={(on) => (on ? dismissHint.mutate({ kind: "todos", restore: true }) : offersOff())}
              />
            </span>
          }
        />
      )}
    </RailRows>
  );
  const offersHead = {
    title: "Not tasks yet",
    icon: <ListTodo className="size-3.5 text-muted-foreground" />,
    meta: rows.length > 0 ? <span className="tabular-nums">{rows.length}</span> : undefined,
    action:
      rows.length > 1 ? (
        <Button size="sm" variant="soft" loading={making === "all"} disabled={making !== null} onClick={makeAll}>
          {aiReady && making === "all" ? "Writing…" : "Make all"}
        </Button>
      ) : undefined,
  };

  if (narrow) {
    // Above the text: the same cards as one, the offers folded to their
    // header, since each offered row has its own disc right there.
    const folded = !rowsShown;
    return (
      <>
        <RailSection
          {...(offersCard
            ? {
                ...offersHead,
                action: (
                  <>
                    {offersHead.action}
                    <Button size="sm" variant="ghost" icon className="-mr-1.5" aria-expanded={!folded} aria-label={folded ? "Show the offers" : "Hide the offers"} onClick={() => setRowsShown((shown) => !shown)}>
                      <ChevronDown className={cn("transition-transform", folded && "-rotate-90")} />
                    </Button>
                  </>
                ),
              }
            : { title: "Suggestions", icon: <Sparkles className="size-3.5 text-muted-foreground" /> })}
          className={cn("mb-4", offersCard && folded && !suggestions && "[&>div:first-child]:mb-0")}
          data-testid="doc-hints"
          aria-label="Doc suggestions"
        >
          {offersCard && !folded && (
            <div data-testid="doc-checklist-tasks">
              {offerList}
              {offersFooter}
            </div>
          )}
          {offersCard && suggestions && (
            <span className={cn("mb-1 block text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-muted-foreground", !folded && "mt-3 border-t border-border pt-3")}>
              Suggestions
            </span>
          )}
          {suggestions && suggestionRows}
        </RailSection>
        {popover}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="doc-hints" aria-label="Doc suggestions">
      {offersCard && (
        <RailSection {...offersHead} data-testid="doc-checklist-tasks">
          {offerList}
          {offersFooter}
        </RailSection>
      )}
      {suggestions && (
        <RailSection title="Suggestions" icon={<Sparkles className="size-3.5 text-muted-foreground" />} data-testid="doc-suggestions">
          {suggestionRows}
        </RailSection>
      )}
      {popover}
    </div>
  );
}

/** A suggestion about the doc as a whole: what it is about on the left, its
 * value, then its button and a dismiss. */
function SuggestionRow({ label, value, meta, action, dismiss }: { label: string; value?: string; meta?: string; action?: ReactNode; dismiss: ReactNode }) {
  return (
    <li className="flex min-h-10 items-center gap-2 border-t border-border py-1.5 first:border-t-0">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{label}</span>
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      </span>
      {value && (
        <span className="min-w-0 max-w-[50%] truncate text-sm font-medium text-foreground" title={value}>
          {value}
        </span>
      )}
      {action}
      <span className="-mr-1.5 flex">{dismiss}</span>
    </li>
  );
}

/** Whether the open doc holds a checklist, kept current as it is edited. */
function useHasChecklist(editor: Editor | null) {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      let found = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === "taskItem") found = true;
        return !found;
      });
      setHas(found);
    };
    read();
    editor.on("update", read);
    return () => {
      editor.off("update", read);
    };
  }, [editor]);
  return has;
}

/** A narrow page's way back to the doc's checklist offers once they are
 * off: a chip under the title. The "Not tasks yet" card's switch turns them
 * off (and, beside a wide page, back on). */
export function ChecklistOffersSwitch({
  doc,
  editor,
  version,
}: {
  doc: Doc;
  editor: Editor | null;
  /** DocHints' version, so both read the same answer. */
  version: string;
}) {
  const { data } = useDocHints(doc.id, version, !doc.isTemplate && !doc.archivedAt);
  const hasChecklist = useHasChecklist(editor);
  const dismissHint = useDismissDocHint(doc.id);
  const off = useDocOffersOff(doc.id, data?.todosOff);
  if (!data?.available || !(hasChecklist || off) || !off) return null;
  return (
    <button
      type="button"
      onClick={() => {
        dismissHint.mutate({ kind: "todos", restore: true });
        useToastStore.getState().show("Tasks are offered from this doc’s checklists again");
      }}
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <ListTodo className="size-3" /> Task offers off · Turn on
    </button>
  );
}
