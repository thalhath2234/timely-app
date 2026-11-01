import type { DocContent } from "./documents";
import { fromMarkdown } from "./markdown";

/**
 * Help me write, shared by the web and phone editors: what the panel offers
 * and how a Markdown answer goes into a TipTap document. The API route is
 * POST /agent/write (apps/api/internal/features/provider/write.go).
 */
export type WriteAction =
  | "write"
  | "continue"
  | "describe"
  | "improve"
  | "shorter"
  | "longer"
  | "fix"
  | "steps"
  | "summarize";

/** What is being edited: a doc, or a task or project description. */
export type WriteKind = "doc" | "task" | "project";

export type WriteRequest = {
  action: WriteAction;
  prompt?: string;
  /** The selected text, plain, for an API from before `selectionDoc`. */
  selection?: string;
  /** The selected part of the doc as a doc (see WriteSpot for its shape).
   * The API reads it as Markdown, so links, @mentions, tick boxes and tables
   * reach the model and come back in its answer. */
  selectionDoc?: DocContent;
  kind: WriteKind;
  title?: string;
  /** Plain text, for an API from before `doc`. */
  text?: string;
  /** The editor's content with WRITE_CURSOR typed where the draft goes. The
   * API reads it as Markdown, so the model sees the checklists, lists and
   * headings around that spot, not just the words. */
  doc?: DocContent;
};

/** Typed into a copy of the doc where the draft goes; the API shows it to
 * the model as <cursor/>. Letters only, so Markdown leaves it alone. */
export const WRITE_CURSOR = "TIMELYWRITECURSOR";

/** The most selected text a rewrite takes, in UTF-8 bytes of Markdown
 * (writeMaxSelection in apps/api/internal/features/provider/write.go). A
 * longer selection is refused, never cut, because Replace puts the answer
 * over all of it. */
export const WRITE_MAX_SELECTION = 20_000;

/** What the panel and the API say about a longer selection. */
export const WRITE_TOO_LONG =
  "That's too much text to rewrite at once. Select up to about 3,000 words and try again.";

/** Whether selected text is over WRITE_MAX_SELECTION. The API measures the
 * Markdown, which links and @mentions make a little longer than this text,
 * so it can still refuse a selection just under the limit. */
export const selectionTooLong = (text: string) => new TextEncoder().encode(text).length > WRITE_MAX_SELECTION;

/** The lists a draft can join as more items. */
export type WriteList = "taskList" | "bulletList" | "orderedList";

export const isWriteList = (type: unknown): type is WriteList =>
  type === "taskList" || type === "bulletList" || type === "orderedList";

/** `text` is Markdown. */
export type WriteResult = { text: string; provider: string; model: string };

/** What the panel says while the AI works on each action. */
export const WRITE_BUSY: Record<WriteAction, string> = {
  write: "Writing",
  continue: "Continuing",
  describe: "Writing a description",
  improve: "Improving",
  shorter: "Shortening",
  longer: "Expanding",
  fix: "Fixing spelling",
  steps: "Making steps",
  summarize: "Summarizing",
};

export type WriteChoice = { action: WriteAction; label: string; prompt?: string };

/** Rewrites offered while text is selected. */
export const SELECTION_ACTIONS: WriteChoice[] = [
  { action: "improve", label: "Improve" },
  { action: "shorter", label: "Shorter" },
  { action: "longer", label: "Longer" },
  { action: "fix", label: "Fix spelling" },
  { action: "steps", label: "Make steps" },
  { action: "summarize", label: "Summarize" },
];

/** One-tap starters when nothing is selected. `hasText` is whether the editor
 * already holds writing, which "Continue" and "Summarize" need. */
export function writeStarters(kind: WriteKind, hasText: boolean): WriteChoice[] {
  if (kind !== "doc") {
    return [
      { action: "describe", label: hasText ? "Rewrite description" : "Write a description" },
      { action: "write", label: "Break into steps", prompt: "A short checklist of the steps to get this done." },
      ...(hasText ? [{ action: "continue" as const, label: "Continue writing" }] : []),
    ];
  }
  return [
    ...(hasText ? [{ action: "continue" as const, label: "Continue writing" }] : []),
    { action: "write", label: "Outline", prompt: "An outline for this doc with short headings and a line under each." },
    { action: "write", label: "Meeting notes", prompt: "Meeting notes for this topic: agenda, notes and action items as a checklist." },
    ...(hasText ? [{ action: "summarize" as const, label: "Summarize" }] : []),
  ];
}

type Node = DocContent & { attrs?: Record<string, unknown>; text?: string };

/** A checkbox the Markdown parser left as text: "[ ] ", "[x] " or "[] "
 * opening the first line of an item in a list that was not all checklist
 * items, or standing alone as an item with no text. */
const BOX_TEXT = /^\[( |x|X)?\](?: |$)/;

/** A list where some items have a tick box becomes a checklist: models mix
 * "- [ ]" and "-" lines, and the boxes would otherwise show as "[ ]" text.
 * fromMarkdown already makes such a list a checklist, but a box Markdown
 * does not read as one ("[] ", or "[ ]" with nothing after it) is still text
 * there. A box with nothing after it is no item at all. Code blocks are left
 * as they are. */
function tidyLists(nodes: Node[]): Node[] {
  return nodes.flatMap((node) => {
    const content = node.content ? tidyLists(node.content as Node[]) : undefined;
    const next = content ? { ...node, content } : node;
    if (next.type !== "bulletList" && next.type !== "orderedList" && next.type !== "taskList") return [next];
    const items = (content ?? []) as Node[];
    const box = (item: Node) => BOX_TEXT.exec(((item.content?.[0] as Node | undefined)?.content?.[0] as Node | undefined)?.text ?? "");
    if (!items.some(box)) return [next];
    const tasks = items.flatMap((item): Node[] => {
      const found = box(item);
      if (!found) return [item.type === "taskItem" ? item : { ...item, type: "taskItem", attrs: { checked: false } }];
      const [line, ...below] = item.content as Node[];
      const [first, ...inline] = line.content as Node[];
      const left = (first.text ?? "").slice(found[0].length);
      if (!left && !inline.length && !below.length) return [];
      return [{
        type: "taskItem",
        attrs: { checked: found[1] === "x" || found[1] === "X" },
        content: [{ ...line, content: left ? [{ ...first, text: left }, ...inline] : inline }, ...below],
      }];
    });
    return tasks.length ? [{ type: "taskList", content: tasks }] : [];
  });
}

/** The items of a list answer, made into items of the list they join: a
 * bulleted or numbered answer joins a checklist as unticked items. A
 * checklist answer does not join a plain list, which would drop its boxes. */
function joinItems(list: Node, into: WriteList): Node[] | null {
  const items = (list.content ?? []) as Node[];
  if (list.type === into) return items;
  if (into !== "taskList") return list.type === "taskList" ? null : items;
  const toTask = (item: Node): Node => ({
    type: "taskItem",
    attrs: { checked: false },
    content: ((item.content ?? []) as Node[]).map((child) =>
      child.type === "bulletList" || child.type === "orderedList"
        ? { type: "taskList", content: ((child.content ?? []) as Node[]).map(toTask) }
        : child,
    ),
  });
  return items.map(toTask);
}

/** Turns a Markdown answer into blocks to insert. A one-paragraph answer comes
 * back as inline content so it can replace words inside a line. With `into`,
 * the list at the spot the draft goes, a one-list answer also comes back as
 * `items` of that list's kind to join it, and `blocks` shows them that way. */
export function writtenContent(
  markdown: string,
  into?: WriteList | null,
): { blocks: DocContent[]; inline: DocContent[] | null; items: DocContent[] | null } {
  // "- []" is a checkbox to the eye but not to Markdown: tidyLists reads it.
  const doc = fromMarkdown(markdown.trim(), { breaks: true }).content;
  let blocks = tidyLists((doc.content ?? []) as Node[]);
  const only = blocks.length === 1 ? blocks[0] : null;
  const items = into && only && isWriteList(only.type) ? joinItems(only, into) : null;
  if (items && into) blocks = [{ type: into, content: items }];
  const inline = only?.type === "paragraph" ? ((only.content ?? []) as DocContent[]) : null;
  return { blocks, inline, items };
}

/**
 * Where the selected text sits, as the editor reads it when Help me write
 * opens (captureSelection in the web's helpMeWrite.tsx, writeInfo in the
 * phone's editorHtml.ts). Replace only ever puts the answer over exactly
 * what was sent, so a selection is one of:
 * - "line": words inside one line (a paragraph, heading, list item's line or
 *   table cell's line). `whole` when they are the line's whole text; `in`
 *   says what holds the line, with the item's `list` and whether the line is
 *   the item's only content (`alone`, no sub-items).
 * - "items": whole items of one list (`list`), with their sub-items. A
 *   selection across items grows to them.
 * - "blocks": whole blocks of the doc, a callout, a column or a table cell
 *   (`in`). A selection across lines grows to the blocks it touches; across
 *   table cells it grows to the whole table.
 */
export type WriteSpot =
  | { kind: "line"; whole: boolean; in: "block" | "item" | "cell"; list?: WriteList | null; alone?: boolean }
  | { kind: "items"; list: WriteList }
  | { kind: "blocks"; in: "block" | "cell" };

/** How an answer replaces the selection:
 * - "inline": a one-paragraph answer goes over the selected words;
 * - "line": the answer's blocks take the place of the selected line;
 * - "item": the answer's items take the place of the line's list item;
 * - "items" / "blocks": the answer's items or blocks take the place of the
 *   selected items or blocks.
 * null: the answer does not fit there (a list for a few words of a line, a
 * table in a table cell), so Replace is not offered; Insert below still is. */
export type WriteFit = "inline" | "line" | "item" | "items" | "blocks" | null;

/** The list an answer for this selection is read into (writtenContent's
 * `into`), so items come back as items of the selected list. */
export const spotList = (spot: WriteSpot | null | undefined): WriteList | null =>
  spot && (spot.kind === "items" || (spot.kind === "line" && spot.in === "item")) ? (spot.list ?? null) : null;

type Written = ReturnType<typeof writtenContent>;

const hasTable = (blocks: DocContent[]) => blocks.some((block) => block.type === "table");

/** Whether and how `answer` (writtenContent(text, spotList(spot))) can
 * replace the selection. It never reaches past the selection: a list answer
 * for some words of a list item does not take the whole item, and nothing
 * nests a list in a line or a table in a table. */
export function replaceFit(spot: WriteSpot, answer: Written): WriteFit {
  if (!answer.blocks.length) return null;
  if (spot.kind === "line") {
    if (answer.inline) return "inline";
    if (!spot.whole) return null;
    if (spot.in === "block") return "line";
    if (spot.in === "item" && spot.alone && answer.items) return "item";
    return null;
  }
  if (spot.kind === "items") return answer.items ? "items" : null;
  if (spot.in === "cell" && hasTable(answer.blocks)) return null;
  return "blocks";
}

/** Where Insert below puts `answer`:
 * - "afterItem": its items join the list right after the line's item;
 * - "afterItems" / "afterBlocks": right after the selected items or blocks;
 * - "afterBlock": after the doc's top-level block the selection ends in. */
export type WriteBelow = "afterItem" | "afterItems" | "afterBlocks" | "afterBlock";

export function belowFit(spot: WriteSpot, answer: Written): WriteBelow {
  if (spot.kind === "line") return spot.in === "item" && answer.items ? "afterItem" : "afterBlock";
  if (spot.kind === "items") return answer.items ? "afterItems" : "afterBlock";
  if (spot.in === "cell" && hasTable(answer.blocks)) return "afterBlock";
  return "afterBlocks";
}
