import type { DocContent } from "./documents";

/** Longest task name the API takes (`maxNameLength` in the task service). */
const MAX_TASK_NAME = 200;

/** An unchecked checklist item in a doc, shaped as the task it could become. */
export interface ChecklistTodo {
  /** The item's whole text, spaces collapsed. */
  text: string;
  /** Its first sentence, as the task name. */
  name: string;
  /** Whatever follows the first sentence; goes in the task description. */
  details: string;
}

type Node = { type?: string; attrs?: Record<string, unknown>; content?: unknown[]; text?: string };

/** Blocks whose checklists are not to-dos: code, diagrams, properties. */
const SKIP = new Set(["frontmatter", "codeBlock", "mermaid"]);

function asNode(value: unknown): Node | null {
  return value && typeof value === "object" ? (value as Node) : null;
}

/** The text of a paragraph's inline nodes; a mention reads as its label. */
function inlineText(node: Node): string {
  let out = "";
  for (const raw of node.content ?? []) {
    const child = asNode(raw);
    if (!child) continue;
    if (child.type === "text") out += child.text ?? "";
    else if (child.type === "mention") out += String(child.attrs?.label ?? "");
    else if (child.type === "hardBreak") out += " ";
    else if (child.content) out += inlineText(child);
  }
  return out;
}

/** Whether the item already links a task, so it is tracked there. */
function linksTask(node: Node): boolean {
  for (const raw of node.content ?? []) {
    const child = asNode(raw);
    if (!child) continue;
    if (child.type === "mention" && child.attrs?.entityType === "task") return true;
    if (child.type !== "taskList" && child.content && linksTask(child)) return true;
  }
  return false;
}

/** Splits an item into a task name (its first sentence) and the rest. */
export function checklistTaskName(text: string): { name: string; details: string } {
  const clean = text.replace(/\s+/g, " ").trim();
  // A sentence ends at . ! or ? followed by a space and a capital letter, as
  // the API's doc hints count sentences ("Ask Dr. smith" stays one).
  const end = /[.!?] (?=\p{Lu})/u.exec(clean);
  let name = end ? clean.slice(0, end.index + 1) : clean;
  let details = end ? clean.slice(end.index + 2).trim() : "";
  if ([...name].length > MAX_TASK_NAME) {
    const cut = [...name].slice(0, MAX_TASK_NAME - 1).join("");
    const space = cut.lastIndexOf(" ");
    name = `${space > MAX_TASK_NAME / 2 ? cut.slice(0, space) : cut}…`;
    details = clean;
  }
  // "Buy milk." reads as a name without its full stop; ! and ? stay.
  name = name.replace(/\.$/, "").trim();
  return { name, details };
}

/** One-word items that read as a to-do on their own: an action ("Call",
 * "Deploy") or a chore that names its action ("Laundry", "Dentist"). */
const ONE_WORD_TASKS = new Set(
  (
    "add apply archive ask backup bake book build buy call cancel change check clean cleanup commit compile confirm contact cook " +
    "debug decide delete deploy design document download draft email exercise export file finish fix follow-up followup " +
    "implement import install invite iron mail meditate meet merge migrate mop move order organise organize pack paint pay " +
    "phone plan post practice practise prepare print publish push read rebase record refactor register release remind renew " +
    "repair reply report research reschedule return review revise run schedule send sign ship shop shower sort study submit " +
    "sweep sync test text tidy train translate unpack update upgrade upload vacuum verify visit vote walk wash water work " +
    "workout write " +
    "appointment bills chores dentist dishes doctor errands groceries gym haircut homework invoice laundry meeting rent " +
    "shopping standup taxes"
  ).split(" ").filter(Boolean),
);

/** Whether an item's name reads as something to do, so it is worth offering
 * as a task. A name of two words or more does; a lone word only when it is an
 * action or a chore, so a stray word ("Adwad"), a label ("Login") or a bare
 * number, date or link is not offered. */
export function readsLikeTask(name: string): boolean {
  const words = name
    .replace(/\b(?:https?:\/\/|www\.)\S+/giu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => /\p{L}/u.test(word));
  if (words.length >= 2) return true;
  return words.length === 1 && ONE_WORD_TASKS.has(words[0].toLowerCase());
}

/** A checklist item's own words: its paragraphs, not its nested items. */
function itemText(node: Node): string {
  return (node.content ?? [])
    .map(asNode)
    .filter((child): child is Node => child?.type === "paragraph")
    .map(inlineText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A checklist item as cards and replies show it (@Checklist, CheckRow). */
export interface DocChecklistItem {
  /** Its place among the doc's checklist items, from 0, empty ones counted;
   * what `PUT /docs/:id/checklist` takes to tick it. */
  item: number;
  /** The item's own words, spaces collapsed. */
  text: string;
  done: boolean;
  /** The heading above its checklist, when there is one. */
  heading: string;
}

/** The text of a heading or paragraph as headings read: spaces collapsed. */
function blockText(node: Node): string {
  return inlineText(node).replace(/\s+/g, " ").trim();
}

/** Every checklist item in a doc, ticked or not, in order, nested ones too;
 * empty ones are left out but keep their place in the numbering. Items in
 * code or properties are not checklist items. The API numbers them the same
 * way (richtext.ChecklistItems) when it ticks one. */
export function checklistItems(content: DocContent | null | undefined): DocChecklistItem[] {
  const out: DocChecklistItem[] = [];
  let item = 0;
  let heading = "";
  const walk = (raw: unknown) => {
    const node = asNode(raw);
    if (!node || SKIP.has(node.type ?? "")) return;
    if (node.type === "heading") {
      heading = blockText(node);
      return;
    }
    if (node.type === "taskItem") {
      const text = itemText(node);
      if (text) out.push({ item, text, done: node.attrs?.checked === true, heading });
      item += 1;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(content);
  return out;
}

/** Compares an item's words the way CheckRow finds them: case and spaces aside. */
export function checklistKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The item a CheckRow means: the one at `item` when its words still match,
 * else the first with those words. */
export function findChecklistItem(items: DocChecklistItem[], text: string, item?: number): DocChecklistItem | undefined {
  const key = checklistKey(text);
  const placed = typeof item === "number" ? items.find((entry) => entry.item === item) : undefined;
  if (placed && checklistKey(placed.text) === key) return placed;
  return items.find((entry) => checklistKey(entry.text) === key);
}

/** What `PUT /docs/:id/checklist` takes: the item by its place and words, and its new state. */
export interface ChecklistTickRequest {
  item: number;
  text: string;
  done: boolean;
}

/** The doc's content with one item ticked or unticked, as the API will save
 * it, for showing a tick at once; null when the doc has no such item. */
export function tickedContent(content: DocContent | null | undefined, tick: ChecklistTickRequest): DocContent | null {
  const target = findChecklistItem(checklistItems(content), tick.text, tick.item);
  if (!content || !target) return null;
  let item = 0;
  const copy = (raw: unknown): unknown => {
    const node = asNode(raw);
    if (!node || SKIP.has(node.type ?? "") || node.type === "heading") return raw;
    let next: Node = node;
    if (node.type === "taskItem") {
      if (item === target.item) next = { ...node, attrs: { ...node.attrs, checked: tick.done } };
      item += 1;
    }
    return next.content ? { ...next, content: next.content.map(copy) } : next;
  };
  return copy(content) as DocContent;
}

/** Unchecked checklist items in a doc, in order, one per distinct task name.
 * Checked items, empty ones, ones that already mention a task and ones inside
 * code or properties are left out. A nested item is its own entry. Items that
 * do not read like a task are still listed, so one made a task anyway is
 * shown as one; the clients offer only those that do (readsLikeTask).
 *
 * `keptLists` are the words of items (lower case) on checklists that are kept
 * in the doc rather than worked as tasks, such as groceries or packing (the
 * API's doc hints, `keptLists`). A checklist holding any of them is left out
 * whole, so an item added to it later is left out too. */
export function openChecklistItems(content: DocContent | null | undefined, keptLists?: readonly string[]): ChecklistTodo[] {
  const out: ChecklistTodo[] = [];
  const seen = new Set<string>();
  const kept = new Set(keptLists ?? []);
  const walk = (raw: unknown) => {
    const node = asNode(raw);
    if (!node || SKIP.has(node.type ?? "")) return;
    if (
      kept.size &&
      node.type === "taskList" &&
      (node.content ?? []).some((child) => {
        const row = asNode(child);
        return row?.type === "taskItem" && kept.has(itemText(row).toLowerCase());
      })
    )
      return;
    if (node.type === "taskItem" && node.attrs?.checked !== true && !linksTask(node)) {
      const text = itemText(node);
      if ([...text].length >= 2) {
        const { name, details } = checklistTaskName(text);
        const key = name.toLowerCase();
        if (name && !seen.has(key)) {
          seen.add(key);
          out.push({ text, name, details });
        }
      }
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(content);
  return out;
}

/** What the AI wrote for one item: a clean task title and a brief description. */
export interface ChecklistTaskDraft {
  title: string;
  description: string;
}

/** What `POST /agent/checklist-tasks` takes: every item being made, in one request. */
export interface ChecklistTasksRequest {
  docTitle: string;
  items: { name: string; details: string }[];
}

/** Its answer: one draft per item, in order; an empty title means none. */
export interface ChecklistTasksResult {
  items: ChecklistTaskDraft[];
  provider: string;
  model: string;
}

/** How long Make task waits for AI titles before using the items' own words. */
export const CHECKLIST_TASKS_TIMEOUT_MS = 10_000;

/** Most items the API names in one request. */
const MAX_DRAFTS = 50;

/** Asks the AI (on the account's default model) for a title and a brief
 * description of each item, in one request. Never throws: an item gets
 * `null`, and keeps its own words, when the request fails, takes longer than
 * `timeoutMs` or has nothing usable for it. */
export async function draftChecklistTasks(
  todos: ChecklistTodo[],
  doc: { title: string },
  ask: (body: ChecklistTasksRequest, signal: AbortSignal) => Promise<ChecklistTasksResult>,
  timeoutMs = CHECKLIST_TASKS_TIMEOUT_MS,
): Promise<(ChecklistTaskDraft | null)[]> {
  const none = todos.map(() => null);
  const sent = todos.slice(0, MAX_DRAFTS);
  if (!sent.length) return none;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      ask({ docTitle: doc.title.trim(), items: sent.map((todo) => ({ name: todo.name, details: todo.details })) }, controller.signal),
      late,
    ]);
    if (!result || !Array.isArray(result.items)) return none;
    return todos.map((_, i) => {
      const draft = result.items[i];
      const title = typeof draft?.title === "string" ? draft.title.replace(/\s+/g, " ").trim() : "";
      if (!title || [...title].length > MAX_TASK_NAME) return null;
      const description = typeof draft.description === "string" ? draft.description.replace(/\s+/g, " ").trim() : "";
      return { title, description };
    });
  } catch {
    return none;
  } finally {
    clearTimeout(timer);
  }
}

/** A task description that keeps the item's extra words and links back to
 * the doc it came from, as rich text and as plain text. With an AI `summary`
 * it leads with that and quotes the item it came from after the link
 * (`From <doc>: “<item>”`), which is also how the API still knows the item
 * is a task once its name no longer matches (DocChecklist). */
export function checklistTaskDescription(
  details: string,
  doc: { id: string; title: string },
  ai?: { summary: string; item: string },
): { description: string; descriptionRich: DocContent } {
  const title = doc.title.trim() || "Untitled";
  const paragraphs: unknown[] = [];
  const lead = ai ? ai.summary.trim() : details;
  if (lead) paragraphs.push({ type: "paragraph", content: [{ type: "text", text: lead }] });
  const quote = ai ? `: “${ai.item.replace(/\s+/g, " ").trim()}”` : "";
  paragraphs.push({
    type: "paragraph",
    content: [
      { type: "text", text: "From " },
      { type: "mention", attrs: { id: doc.id, label: title, entityType: "doc" } },
      ...(quote ? [{ type: "text", text: quote }] : []),
    ],
  });
  const from = `From ${title}${quote}`;
  return {
    description: lead ? `${lead}\n\n${from}` : from,
    descriptionRich: { type: "doc", content: paragraphs },
  };
}

/** Blocks whose lines the API never offers as tasks of their own (doc hints'
 * workLines): a checklist item is offered above, as a checklist item. */
const NOT_WORK = new Set(["frontmatter", "codeBlock", "heading", "table", "mermaid", "details", "taskItem"]);

/** The text of a node as the API reads it: text nodes only, spaces collapsed. */
function plainText(node: Node): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map((raw) => {
    const child = asNode(raw);
    return child ? plainText(child) : "";
  }).join("");
}

/** The doc's plain paragraphs, lower-cased with spaces collapsed: the lines a
 * "reads like a task" suggestion can be about. A suggestion whose line is no
 * longer one of these (it was edited, finished being typed, or turned into a
 * checklist item since it was read) is out of date and not shown. */
export function docWorkLines(content: DocContent | null | undefined): Set<string> {
  const out = new Set<string>();
  const walk = (raw: unknown) => {
    const node = asNode(raw);
    if (!node || NOT_WORK.has(node.type ?? "")) return;
    if (node.type === "paragraph") {
      const text = plainText(node).replace(/\s+/g, " ").trim().toLowerCase();
      if (text) out.add(text);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(content);
  return out;
}

/** Compares a suggested line with docWorkLines. */
export function workLineKey(line: string): string {
  return line.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The name and description of the task an item becomes: the AI's title and
 * brief description when there is a draft, else the item's own words. */
export function checklistTask(
  todo: ChecklistTodo,
  doc: { id: string; title: string },
  draft?: ChecklistTaskDraft | null,
): { name: string; description: string; descriptionRich: DocContent } {
  if (!draft?.title.trim()) return { name: todo.name, ...checklistTaskDescription(todo.details, doc) };
  return { name: draft.title.trim(), ...checklistTaskDescription(todo.details, doc, { summary: draft.description, item: todo.text }) };
}

/** The task a "reads like a task" line becomes: the line as its name, and a
 * description that links the doc and quotes the line (`From <doc>: “<line>”`),
 * so the API still knows the line is a task after the line or the task is
 * reworded (doc hints' madeSinceDoc). */
export function workLineTask(line: string, doc: { id: string; title: string }): { name: string; description: string; descriptionRich: DocContent } {
  const name = line.replace(/\s+/g, " ").trim();
  return { name, ...checklistTaskDescription("", doc, { summary: "", item: name }) };
}
