import { openChecklistItems } from "@timely/contract/docChecklist";
import type { DocContent } from "../../lib/types";

/** A suggestion about one checklist row, shown in the doc as a marker at the
 * row's end; an item that is not a task yet opens a card under its row. */
export type LineHint = {
  key: string;
  kind: "todo" | "task";
  /** The row's words as `lineText` reads them; the editor finds the row by them. */
  text: string;
  name: string;
  details?: string;
};

/** What the doc's rows show and what their markers and cards do. */
export type LineHints = {
  hints: LineHint[];
  /** The row whose card is open. */
  open: string | null;
  /** The row a task is being made from. */
  busy: string | null;
  /** The project new tasks go to. */
  target: string | null;
  /** Whether the AI is writing the task's title while it is made. */
  writing: boolean;
  act: (key: string, action: "toggle" | "make" | "dismiss") => void;
};

type Node = { type?: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string };

/** A checklist row's words as the editor page reads them from its document:
 * the text of the row's own paragraphs, spaces collapsed. The editor page
 * (editorHtml.ts, hintLineText) must read them the same way. */
function lineText(item: Node): string {
  const collect = (node: Node): string => (node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(collect).join(""));
  return (item.content ?? [])
    .filter((child) => child.type === "paragraph")
    .map(collect)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Each unchecked checklist row's words, by its item's name in lower case
 * (the key suggestions use); the first row wins where two share a name. */
export function checklistLines(content: DocContent | null | undefined): Map<string, string> {
  const lines = new Map<string, string>();
  const walk = (node: Node | null | undefined) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "taskItem") {
      // Only the row itself: its nested rows are read on their own.
      const row = { ...node, content: (node.content ?? []).filter((child) => child.type === "paragraph") };
      const [item] = openChecklistItems({ type: "doc", content: [row] } as DocContent);
      const key = item?.name.toLowerCase();
      if (key && !lines.has(key)) lines.set(key, lineText(node));
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(content as Node | null | undefined);
  return lines;
}
