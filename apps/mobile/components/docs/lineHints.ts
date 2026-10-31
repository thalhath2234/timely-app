import { openChecklistItems } from "@timely/contract/docChecklist";
import type { DocContent } from "../../lib/types";

/** A suggestion about one line of the doc, shown as a marker at the line's
 * end: a checklist row or a line that reads like a task, not a task yet,
 * opens a card under its line; a row that is a task already opens the task. */
export type LineHint = {
  key: string;
  kind: "todo" | "work" | "task";
  /** The line's words as `docLines` reads them; the editor finds the line by
   * them (a work line's are lower case). */
  text: string;
  name: string;
  details?: string;
  /** Where the task goes: a project's title, or the Inbox when none. */
  target?: string;
  /** The task goes to the Inbox (told apart from a project of that name). */
  targetInbox?: boolean;
  /** The project's colour, for its dot. */
  targetColor?: string;
};

/** What the doc's lines show and what their markers and cards do. */
export type LineHints = {
  hints: LineHint[];
  /** The line whose card is open. */
  open: string | null;
  /** The line a task is being made from, or "all" for every offer. */
  busy: string | null;
  /** Whether the AI is writing the task's title while it is made. */
  writing: boolean;
  /** Counts up each time the open line is asked for from outside the doc
   * (a row in the suggestions sheet), so the editor scrolls it into view even
   * when its card was open already. */
  reveal: number;
  /** "goesTo": the card's Goes to row, to pick a place for that task alone. */
  act: (key: string, action: "toggle" | "make" | "dismiss" | "goesTo") => void;
};

type Node = { type?: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string };

/** A line of the doc that can be offered as a task, in reading order, with
 * the heading it sits under. */
export type DocLine = {
  kind: "todo" | "work";
  /** A checklist row's item name in lower case (the key suggestions use), or
   * a work line's words as `workLineKey` reads them. */
  key: string;
  /** The line's words as the editor page reads them (editorHtml.ts,
   * hintLineText and hintWorkText). */
  text: string;
  /** The nearest heading before the line; empty above the first one. */
  section: string;
  /** In a folded toggle: hidden, so not offered until it is unfolded. */
  folded?: boolean;
};

/** Blocks whose lines are never offered as tasks of their own, as the shared
 * contract's docWorkLines reads them: a checklist row is offered as a
 * checklist item instead. */
const NOT_WORK = new Set(["frontmatter", "codeBlock", "heading", "table", "mermaid", "details", "taskItem"]);

const words = (node: Node): string => (node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(words).join(""));

/** A checklist row's words: the text of the row's own paragraphs, spaces
 * collapsed. */
function rowText(item: Node): string {
  return (item.content ?? [])
    .filter((child) => child.type === "paragraph")
    .map(words)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The doc's checklist rows and plain lines, in reading order, each with the
 * heading it sits under. A checklist row is listed under its item's name, the
 * first row winning where two share one; a plain line under its words, the
 * first one winning too. A row in a folded toggle is marked folded, and
 * loses to a shown row with the same name. */
export function docLines(content: DocContent | null | undefined): DocLine[] {
  const all: DocLine[] = [];
  let section = "";
  let folded = false;
  const add = (line: DocLine) => all.push(folded ? { ...line, folded } : line);
  const walk = (node: Node | null | undefined, inBlock: boolean) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "details" && node.attrs?.open === false && !folded) {
      folded = true;
      for (const child of node.content ?? []) walk(child, true);
      folded = false;
      return;
    }
    if (node.type === "heading") {
      const title = words(node).replace(/\s+/g, " ").trim();
      if (title) section = title;
      return;
    }
    if (node.type === "taskItem") {
      // Only the row itself: its nested rows are read on their own.
      const row = { ...node, content: (node.content ?? []).filter((child) => child.type === "paragraph") };
      const [item] = openChecklistItems({ type: "doc", content: [row] } as DocContent);
      const key = item?.name.toLowerCase();
      if (key) add({ kind: "todo", key, text: rowText(node), section });
    } else if (node.type === "paragraph" && !inBlock) {
      const text = words(node).replace(/\s+/g, " ").trim().toLowerCase();
      if (text) add({ kind: "work", key: text, text, section });
      return;
    }
    const skip = inBlock || NOT_WORK.has(node.type ?? "");
    for (const child of node.content ?? []) walk(child, skip);
  };
  walk(content as Node | null | undefined, false);
  const id = (line: DocLine) => `${line.kind}:${line.key}`;
  const shown = new Set(all.filter((line) => !line.folded).map(id));
  const seen = new Set<string>();
  return all.filter((line) => {
    if (seen.has(id(line)) || (line.folded && shown.has(id(line)))) return false;
    seen.add(id(line));
    return true;
  });
}

/** Whether the doc holds a checklist, ticked or not. */
export function hasChecklist(content: DocContent | null | undefined): boolean {
  const walk = (node: Node | null | undefined): boolean =>
    Boolean(node && typeof node === "object" && (node.type === "taskItem" || (node.content ?? []).some(walk)));
  return walk(content as Node | null | undefined);
}

/** The summary of the offers: "5 items aren’t tasks yet" over "3 lines · 2
 * checklist items". */
export function offerSummary(lines: number, items: number): { title: string; detail: string } {
  const count = lines + items;
  return {
    title: count === 1 ? "1 item isn’t a task yet" : `${count} items aren’t tasks yet`,
    detail: [lines ? `${lines} ${lines === 1 ? "line" : "lines"}` : "", items ? `${items} checklist ${items === 1 ? "item" : "items"}` : ""]
      .filter(Boolean)
      .join(" · "),
  };
}
