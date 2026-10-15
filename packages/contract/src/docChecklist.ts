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

/** Unchecked checklist items in a doc, in order, one per distinct task name.
 * Checked items, empty ones, ones that already mention a task and ones inside
 * code or properties are left out. A nested item is its own entry.
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
