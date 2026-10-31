import { docTypePhrase } from "@timely/contract/documents";
import { checklistTask, docWorkLines, draftChecklistTasks, openChecklistItems, workLineKey, workLineTask, type ChecklistTodo } from "@timely/contract/docChecklist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ChevronRight, Inbox, ListTodo, Plus, Sparkles, X } from "lucide-react-native";
import { contentFromTemplate, templateVars } from "@timely/contract/templates";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { GroupLabel, ListGroup, ListRow, ListSwitch, SwitchRow } from "../settings/SettingsList";
import ConfirmSheet from "../ui/ConfirmSheet";
import { getDoc } from "../../lib/api/docs";
import { checklistTaskDrafts } from "../../lib/api/write";
import { readyProviders } from "../chat/ModelSheet";
import { Button } from "../ui/primitives";
import {
  useAgentProvidersQuery,
  useCreateTask,
  useDecisionFeedback,
  useDecisionsStatusQuery,
  useDeleteTask,
  useDismissDocHint,
  useDocChecklistQuery,
  useDocOffersOff,
  useDocHintsQuery,
  useProjectQuery,
  useProjectsQuery,
  useRelatedQuery,
  useUpdateDoc,
} from "../../lib/hooks";
import { hrefFor } from "../../lib/searchRoutes";
import { showUndoToast, useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import type { DocHintKind } from "../../lib/api/decisions";
import type { Doc, DocContent, Task } from "../../lib/types";
import { docLines, hasChecklist, offerSummary, type LineHint, type LineHints } from "./lineHints";

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

/** A line of the doc offered as a task: an unchecked checklist row Jev reads
 * as something to get done, or a line that reads like a task. */
type Offer = {
  /** `todo:<item name in lower case>` or `work:<line>`, as dismissals hide them. */
  key: string;
  name: string;
  details?: string;
  /** The line's words for the editor's marker; empty when it is not found. */
  text: string;
  /** The heading the line sits under. */
  section: string;
  todo?: ChecklistTodo;
  line?: string;
};

/** Smart suggestions for a doc on the phone, as on the web: a template for a
 * near-empty page, the project or page it may belong under, its type and
 * property values (set in the doc's Properties block), lines that read like
 * tasks, and whether it looks out of date. Above them, the lines offered as
 * tasks: the doc's unchecked checklist items that Jev reads as things to get
 * done, and the lines that read like tasks; the checklist offers can be
 * turned off for the doc. Above the doc it is one summary row; the rows
 * themselves open in a sheet, grouped by the doc's headings, so the doc keeps
 * the screen. Each offered line also gets a marker in the doc itself
 * (`onLineHints`), which opens a card with its offer under the line. */
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
  /** The markers and cards for the doc's offered lines, for the editor;
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
  // Checklist offers answered so far, by decision: one answer each.
  const answered = useRef(new Set<string>());
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  const [making, setMaking] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The offered line whose card is open in the doc, and a count that asks
  // the editor to scroll it into view again (a row tapped in the sheet).
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [reveal, setReveal] = useState(0);
  // With an AI provider set up (Settings > Agent keys), Make task first asks
  // its default model for a clean title and a brief description.
  const aiReady = readyProviders(useAgentProvidersQuery().data).length > 0;

  const todos = useMemo(() => (live ? openChecklistItems(content) : []), [content, live]);
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
  // Offered only while smart suggestions are on, and only the items Jev reads
  // as things to get done (a call, an errand), not ones kept in the doc to
  // tick off there (milk, an ingredient).
  const offered = new Set((checklist.data?.offer ?? []).map((name) => name.toLowerCase()));
  const offersAreOff = useDocOffersOff(doc.id, checklist.data?.off);
  const open = offersAreOff
    ? []
    : todos.filter((todo) => {
        const key = todo.name.toLowerCase();
        return offered.has(key) && checked.has(key) && !taken.has(key) && !hidden.has(`todo:${key}`);
      });
  // Items that are tasks already are named under the open ones, so it is
  // clear why they are not offered; alone they are not worth a card.
  const already = (checklist.data?.existing ?? []).filter((task) => todos.some((todo) => todo.name.toLowerCase() === task.name.toLowerCase()));
  const router = useRouter();
  const hints = data?.available ? data : undefined;
  const work = (hints?.work ?? []).filter((line) => workLines.has(workLineKey(line)) && !hidden.has(`work:${line}`));
  // Both kinds in reading order, each under its heading, so the sheet's
  // groups and the markers in the doc go top to bottom together.
  const lines = useMemo(() => docLines(content), [content]);
  const offers: Offer[] = [];
  const todoByKey = new Map(open.map((todo) => [todo.name.toLowerCase(), todo]));
  const workByKey = new Map(work.map((line) => [workLineKey(line), line]));
  for (const line of lines) {
    // A folded toggle's row is hidden, so it has no marker and is neither
    // listed nor counted until the toggle is unfolded.
    if (line.folded) {
      todoByKey.delete(line.key);
      continue;
    }
    const todo = line.kind === "todo" ? todoByKey.get(line.key) : undefined;
    const found = line.kind === "work" ? workByKey.get(line.key) : undefined;
    if (todo) {
      todoByKey.delete(line.key);
      offers.push({ key: `todo:${line.key}`, name: todo.name, details: todo.details || undefined, text: line.text, section: line.section, todo });
    } else if (found) {
      workByKey.delete(line.key);
      offers.push({ key: `work:${found}`, name: found, text: line.text, section: line.section, line: found });
    }
  }
  // Not expected, but an offer whose line is not found still counts and is
  // listed in the sheet; it only has no marker.
  for (const todo of todoByKey.values()) offers.push({ key: `todo:${todo.name.toLowerCase()}`, name: todo.name, details: todo.details || undefined, text: "", section: "", todo });
  for (const found of workByKey.values()) offers.push({ key: `work:${found}`, name: found, text: "", section: "", line: found });
  // A checklist item goes to the project above; a line that reads like a
  // task goes to the doc's own project, as it always has.
  const docProject = useProjectQuery(doc.projectId ?? undefined).data;
  // SKETCH: one pick for the whole doc, from the sheet's Goes to row.
  const allProjects = useProjectsQuery().data ?? [];
  const [docPick, setDocPick] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const autoGoesTo = (offer: Offer): string | undefined =>
    offer.todo ? (target?.title ?? "Inbox") : doc.projectId ? (docProject?.id === doc.projectId ? docProject.title : undefined) : "Inbox";
  const goesTo = (offer: Offer): string | undefined =>
    docPick === null ? autoGoesTo(offer) : docPick ? allProjects.find((project) => project.id === docPick)?.title : "Inbox";
  const pickedId = docPick ?? "";

  const hide = (key: string) => setHidden((prev) => new Set(prev).add(key));
  // Tells Jev whether its checklist offers were wanted: a task made from one,
  // or one dismissed.
  const answerOffers = (accepted: boolean) => {
    const logId = checklist.data?.logId;
    if (!logId || answered.current.has(logId)) return;
    answered.current.add(logId);
    feedback.mutate({ logId, accepted });
  };
  // A dismissed item is not offered again in this doc, on any device.
  const dropTodo = (name: string) => {
    hide(`todo:${name.toLowerCase()}`);
    dismissHint.mutate({ kind: "todo", value: name });
    answerOffers(false);
  };
  // A line that reads like a task is kept dismissed for the doc too.
  const dismissWork = (line: string) => {
    hide(`work:${line}`);
    dismissHint.mutate({ kind: "work", value: line });
  };
  const dismissOffer = (offer: Offer) => {
    setOpenLine((current) => (current === offer.key ? null : current));
    if (offer.line) dismissWork(offer.line);
    else dropTodo(offer.name);
  };
  // Turned off for this doc on every device; the switch here, the doc's
  // More menu, or the undo turns them back on.
  const offersOff = () => {
    const logId = checklist.data?.logId;
    // The same offers come back if this is not saved or is undone, so a task
    // made from one can still say so.
    const offersBack = () => {
      if (logId) answered.current.delete(logId);
    };
    setSheetOpen(false);
    dismissHint.mutate({ kind: "todos" }, { onError: offersBack });
    answerOffers(false);
    showUndoToast("Tasks won’t be offered from this doc’s checklists", () => {
      offersBack();
      dismissHint.mutate({ kind: "todos", restore: true });
    });
  };
  const make = async (list: Offer[], key: string) => {
    setMaking(key);
    const todoList = list.flatMap((offer) => (offer.todo ? [offer.todo] : []));
    if (todoList.length) answerOffers(true);
    if (todoList.length < list.length) accept();
    // One request for all the checklist items, a few seconds at most;
    // without a provider, or on any error, the tasks keep the items' own
    // words. A line that reads like a task keeps its words as they are.
    const drafts = aiReady && todoList.length ? await draftChecklistTasks(todoList, doc, (body) => checklistTaskDrafts(body)) : todoList.map(() => null);
    const made: { task: Task; offer: Offer }[] = [];
    for (const offer of list) {
      try {
        const task = await createTask.mutateAsync(
          offer.todo
            ? {
                ...checklistTask(offer.todo, doc, drafts[todoList.indexOf(offer.todo)]),
                kind: "task",
                duration: 30,
                workspaceId: target?.workspaceId ?? doc.workspaceId,
                projectId: target?.id,
              }
            : { ...workLineTask(offer.line ?? offer.name, doc), kind: "task", duration: 30, workspaceId: doc.workspaceId, projectId: doc.projectId ?? undefined },
        );
        made.push({ task, offer });
        hide(offer.key);
        // Kept for the doc, so the line is not offered again once it or the
        // task is reworded; this reads the suggestions again too.
        if (offer.line) dismissHint.mutate({ kind: "work", value: offer.line });
      } catch {
        // Reported below with the count.
      }
    }
    setMaking(null);
    // The card stays open while its task is made ("Writing…"), then closes;
    // an undo brings the line back with its card closed.
    setOpenLine((current) => (made.some(({ offer }) => offer.key === current) ? null : current));
    void queryClient.invalidateQueries({ queryKey: ["doc-checklist", doc.id] });
    if (!made.length) {
      useToastStore.getState().show("Could not add the task");
      return;
    }
    // Named only when every task went to the same project.
    const places = new Set(made.map(({ offer }) => goesTo(offer)));
    const [place] = places;
    const where = places.size === 1 && place && place !== "Inbox" ? ` to ${place}` : "";
    const message =
      made.length === 1 ? `Task added${where}: ${made[0].task.name}` : `${made.length} tasks added${where}${made.length < list.length ? `, ${list.length - made.length} failed` : ""}`;
    showUndoToast(message, () => {
      for (const { task } of made) deleteTask.mutate(task.id);
      setHidden((prev) => {
        const next = new Set(prev);
        for (const { offer } of made) next.delete(offer.key);
        return next;
      });
      for (const { offer } of made) if (offer.line) dismissHint.mutate({ kind: "work", value: offer.line, restore: true });
      void queryClient.invalidateQueries({ queryKey: ["doc-checklist", doc.id] });
    });
  };

  // The lines' markers and cards in the doc. The editor gets plain data and
  // one stable `act`, so it is only told again when what it shows changes.
  const lineHints: LineHint[] = [
    ...offers.map((offer) => ({
      key: offer.key,
      kind: offer.todo ? ("todo" as const) : ("work" as const),
      text: offer.text,
      name: offer.name,
      details: offer.details,
      target: goesTo(offer),
    })),
    ...already.map((task) => ({
      key: `task:${task.taskId}`,
      kind: "task" as const,
      text: lines.find((line) => line.kind === "todo" && line.key === task.name.toLowerCase())?.text ?? "",
      name: task.name,
    })),
  ].filter((hint) => hint.text);
  const actRef = useRef<LineHints["act"]>(() => undefined);
  actRef.current = (key, action) => {
    if (key.startsWith("task:")) {
      router.push(hrefFor("task", key.slice("task:".length)));
      return;
    }
    if (action === "toggle") {
      setOpenLine((current) => (current === key ? null : key));
      return;
    }
    const offer = offers.find((item) => item.key === key);
    if (action === "dismiss") {
      if (offer) dismissOffer(offer);
      else if (key.startsWith("todo:")) dropTodo(key.slice("todo:".length));
    } else if (offer) void make([offer], key);
  };
  const act = useCallback<LineHints["act"]>((key, action) => actRef.current(key, action), []);
  const lineSignature = JSON.stringify([lineHints, openLine, making, aiReady, reveal]);
  const onLineHintsRef = useRef(onLineHints);
  onLineHintsRef.current = onLineHints;
  useEffect(() => {
    const [hintList, openKey, busy, writing, revealed] = JSON.parse(lineSignature) as [LineHint[], string | null, string | null, boolean, number];
    onLineHintsRef.current?.(hintList.length ? { hints: hintList, open: openKey, busy, writing, reveal: revealed, act } : null);
  }, [lineSignature, act]);
  useEffect(() => () => onLineHintsRef.current?.(null), []);

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
  if (hints?.outdated) {
    rows.push({
      key: "outdated",
      kind: "outdated",
      text: "This doc may be out of date. It has not been edited in a while and talks about plans or dates that have likely passed.",
    });
  }
  const shown = rows.filter((row) => !hidden.has(row.key));
  if (!shown.length && !offers.length && !confirmTemplate) return null;

  // The offers in the sheet, grouped under the headings their lines sit
  // under, top to bottom.
  const groups: { section: string; offers: Offer[] }[] = [];
  for (const offer of offers) {
    const last = groups[groups.length - 1];
    if (last && last.section === offer.section) last.offers.push(offer);
    else groups.push({ section: offer.section, offers: [offer] });
  }
  // One "Goes to" row while every offer goes to the same place; otherwise
  // each row names its own.
  const places = new Set(offers.map(goesTo).filter((value): value is string => Boolean(value)));
  const [place] = places;
  const mixed = places.size > 1;
  // The switch sits with the offers it governs while the doc has a
  // checklist, or while they are off so they can come back.
  const showSwitch = Boolean(hints) && (hasChecklist(content) || offersAreOff);
  // A row's words close the sheet and open the line's card in the doc,
  // scrolled into view.
  const showLine = (offer: Offer) => {
    setSheetOpen(false);
    setOpenLine(offer.key);
    setReveal((count) => count + 1);
  };
  const writingAll = aiReady && making === "all" && offers.some((offer) => offer.todo);

  const body = (
    <View style={styles.body} testID="doc-hints">
      {offers.length > 0 || showSwitch ? (
        <View testID="doc-checklist-tasks">
          {groups.map((group, index) => (
            <View key={`${index}:${group.section}`}>
              {group.section ? <GroupLabel>{group.section}</GroupLabel> : null}
              <ListGroup style={styles.group}>
                {group.offers.map((offer) => {
                  const kind = offer.todo ? "Checklist item" : "Reads like a task";
                  const where = mixed ? goesTo(offer) : undefined;
                  return (
                    <View key={offer.key} style={styles.offerRow}>
                      <AnimatedPressable
                        accessibilityRole="button"
                        accessibilityLabel={`${offer.name}, ${kind}. Show in the doc`}
                        onPress={() => showLine(offer)}
                        disabled={!offer.text}
                        style={styles.offerText}
                      >
                        <Text numberOfLines={2} style={styles.offerName}>{offer.name}</Text>
                        <Text numberOfLines={1} style={styles.offerMeta}>
                          {[kind, offer.details, where && `Goes to ${where}`].filter(Boolean).join(" · ")}
                        </Text>
                      </AnimatedPressable>
                      {/* Icon only: on a 390px phone a labelled button left the item's
                          own words two cut-off lines. The summary says what + does. */}
                      <Button
                        size="sm"
                        variant="outline"
                        iconOnly
                        label="Make task"
                        accessibilityLabel={`Make task: ${offer.name}`}
                        icon={<Plus size={16} color={colors.foreground} />}
                        loading={making === offer.key}
                        disabled={making !== null}
                        onPress={() => void make([offer], offer.key)}
                      />
                      {/* A line's card in the doc has its Dismiss; an offer whose line
                          is not found there has no card, so it is dismissed here. */}
                      {offer.text ? null : (
                        <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Dismiss ${offer.name}`} onPress={() => dismissOffer(offer)} style={styles.dismiss} hitSlop={8}>
                          <X size={14} color={colors.mutedForeground} />
                        </AnimatedPressable>
                      )}
                    </View>
                  );
                })}
              </ListGroup>
            </View>
          ))}
          {(offers.length > 0 && place && !mixed) || showSwitch ? (
            <ListGroup style={styles.settings}>
              {offers.length > 0 && place && !mixed ? <ListRow
                  title="Goes to"
                  trailing={
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      {pickedId ? (
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: allProjects.find((project) => project.id === pickedId)?.color ?? colors.mutedForeground }} />
                      ) : (
                        <Inbox size={15} color={colors.mutedForeground} />
                      )}
                      <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>{place}</Text>
                    </View>
                  }
                  onPress={() => setPicking(true)}
                  accessibilityLabel={`Tasks go to ${place}`}
                /> : null}
              {showSwitch ? (
                <SwitchRow
                  title="Offer tasks from checklists"
                  value={!offersAreOff}
                  onChange={(next) => (next ? dismissHint.mutate({ kind: "todos", restore: true }) : offersOff())}
                />
              ) : null}
            </ListGroup>
          ) : null}
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
        </View>
      ) : null}
      {shown.length > 0 ? (
        <View>
          {offers.length > 0 || showSwitch ? <GroupLabel>More suggestions</GroupLabel> : null}
          <ListGroup style={styles.group}>
            {shown.map((row) => (
              <View key={row.key} style={styles.suggestion}>
                <Text style={styles.suggestionText}>{row.text}</Text>
                {row.run ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    label={row.label ?? ""}
                    onPress={() => {
                      row.run!();
                      if (row.manual) return;
                      accept();
                      hide(row.key);
                    }}
                  />
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
          </ListGroup>
        </View>
      ) : null}
    </View>
  );
  // Makes every offer the count names: the checklist items and the lines
  // that read like tasks.
  const makeAll =
    offers.length > 1 ? (
      <Button
        size="lg"
        stretch
        label={writingAll ? "Writing titles…" : `Make all ${offers.length}`}
        accessibilityLabel={`Make ${offers.length} tasks`}
        icon={<Plus size={18} color={colors.primaryForeground} />}
        loading={making === "all"}
        disabled={making !== null}
        onPress={() => void make(offers, "all")}
      />
    ) : undefined;

  const offerCopy = offerSummary(offers.filter((offer) => offer.line).length, offers.filter((offer) => offer.todo).length);
  const summary = offers.length ? offerCopy.title : shown.length === 1 ? "1 suggestion for this doc" : `${shown.length} suggestions for this doc`;
  const detail = offers.length ? offerCopy.detail : "";

  return (
    <>
      {shown.length || offers.length ? (
        // "Make all" sits beside the row, not inside it: one button may not hold another.
        <View style={styles.summary}>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={`${summary}${detail ? `, ${detail}` : ""}. Show`}
            onPress={() => setSheetOpen(true)}
            style={styles.summaryOpen}
            testID="doc-hints-summary"
          >
            {offers.length ? <ListTodo size={16} color={colors.primary} /> : <Sparkles size={16} color={colors.primary} />}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={styles.todoTitle}>{summary}</Text>
              {detail ? <Text numberOfLines={1} style={styles.text}>{detail}</Text> : null}
            </View>
            {offers.length > 1 ? null : <ChevronRight size={18} color={colors.mutedForeground} />}
          </AnimatedPressable>
          {offers.length > 1 ? (
            <Button
              size="sm"
              variant="secondary"
              label={writingAll ? "Writing…" : "Make all"}
              accessibilityLabel={`Make ${offers.length} tasks`}
              loading={making === "all"}
              disabled={making !== null}
              onPress={() => void make(offers, "all")}
            />
          ) : null}
        </View>
      ) : null}
      <BottomSheet open={sheetOpen && (shown.length > 0 || offers.length > 0)} onClose={() => setSheetOpen(false)} title="Suggestions" footer={makeAll}>
        {body}
      </BottomSheet>
      <BottomSheet open={picking} onClose={() => setPicking(false)} title="Goes to" subtitle="Tasks made from this doc">
        <SheetOption selected={!pickedId} leading={<Inbox size={18} color={colors.mutedForeground} />} onSelect={() => { setDocPick(""); setPicking(false); }}>
          Inbox
        </SheetOption>
        {allProjects.map((project) => (
          <SheetOption
            key={project.id}
            selected={project.id === pickedId}
            leading={<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: project.color ?? colors.mutedForeground }} />}
            onSelect={() => { setDocPick(project.id); setPicking(false); }}
          >
            {project.title}
          </SheetOption>
        ))}
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

/** The doc's switch for checklist items offered as tasks, in its More menu:
 * shown while smart suggestions are on and the doc has a checklist, or while
 * the offers are off so they can come back. The same switch sits with the
 * offers in the suggestions sheet. */
export function ChecklistOffersOption({ doc, content, version }: { doc: Doc; content: DocContent | null | undefined; version: string }) {
  const live = !doc.isTemplate && !doc.archivedAt;
  const on = useDecisionsStatusQuery(live).data?.available === true;
  const { data } = useDocHintsQuery(doc.id, version, live);
  const dismissHint = useDismissDocHint(doc.id);
  const has = useMemo(() => hasChecklist(content), [content]);
  const off = useDocOffersOff(doc.id, data?.todosOff);
  if (!on || !data?.available || !(has || off)) return null;
  const turn = (next: boolean) => dismissHint.mutate({ kind: "todos", restore: next });
  return (
    <SheetOption onSelect={() => turn(off)} leading={<ListTodo size={18} color={colors.mutedForeground} />}>
      <View style={styles.option}>
        <Text style={styles.optionText}>Offer tasks from checklists</Text>
        <ListSwitch label="Offer tasks from checklists" value={!off} onChange={turn} />
      </View>
    </SheetOption>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  option: { flexDirection: "row", alignItems: "center", gap: 12 },
  optionText: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" },
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
  body: { paddingBottom: 8 },
  text: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  dismiss: { padding: 4 },
  group: { marginTop: 4 },
  settings: { marginTop: 16 },
  offerRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingLeft: 14, paddingRight: 10, paddingVertical: 8 },
  offerText: { flex: 1, minWidth: 0, minHeight: 40, justifyContent: "center" },
  offerName: { color: colors.foreground, fontSize: 15, lineHeight: 20, fontWeight: "500" },
  offerMeta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16, marginTop: 2 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 56, paddingLeft: 14, paddingRight: 10, paddingVertical: 8 },
  suggestionText: { flex: 1, color: colors.foreground, fontSize: 14, lineHeight: 19 },
  todoTitle: { color: colors.foreground, fontSize: 14, lineHeight: 19, fontWeight: "600" },
  already: { marginTop: 10, marginHorizontal: 4, fontSize: 12 },
  link: { color: colors.primary, fontWeight: "500" },
}));
