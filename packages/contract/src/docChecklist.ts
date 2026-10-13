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

/** Unchecked checklist items in a doc, in order, one per distinct task name.
 * Checked items, empty ones, ones that already mention a task and ones inside
 * code or properties are left out. A nested item is its own entry. */
export function openChecklistItems(content: DocContent | null | undefined): ChecklistTodo[] {
  const out: ChecklistTodo[] = [];
  const seen = new Set<string>();
  const walk = (raw: unknown) => {
    const node = asNode(raw);
    if (!node || SKIP.has(node.type ?? "")) return;
    if (node.type === "taskItem" && node.attrs?.checked !== true && !linksTask(node)) {
      const text = (node.content ?? [])
        .map(asNode)
        .filter((child): child is Node => child?.type === "paragraph")
        .map(inlineText)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
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

/** A task description that keeps the item's extra words and links back to
 * the doc it came from, as rich text and as plain text. */
export function checklistTaskDescription(details: string, doc: { id: string; title: string }): { description: string; descriptionRich: DocContent } {
  const title = doc.title.trim() || "Untitled";
  const paragraphs: unknown[] = [];
  if (details) paragraphs.push({ type: "paragraph", content: [{ type: "text", text: details }] });
  paragraphs.push({
    type: "paragraph",
    content: [
      { type: "text", text: "From " },
      { type: "mention", attrs: { id: doc.id, label: title, entityType: "doc" } },
    ],
  });
  return {
    description: details ? `${details}\n\nFrom ${title}` : `From ${title}`,
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
