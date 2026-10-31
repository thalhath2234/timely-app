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
  selection?: string;
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

/** A checkbox the Markdown parser left as text: "[ ] " or "[x] " opening the
 * first line of an item in a list that was not all checklist items. */
const BOX_TEXT = /^\[( |x|X)\] /;

/** A list where some items have a tick box becomes a checklist: models mix
 * "- [ ]" and "-" lines, and the boxes would otherwise show as "[ ]" text. */
function tidyLists(nodes: Node[]): Node[] {
  return nodes.map((node) => {
    const content = node.content ? tidyLists(node.content as Node[]) : undefined;
    const next = content ? { ...node, content } : node;
    if (next.type !== "bulletList" && next.type !== "orderedList") return next;
    const items = (content ?? []) as Node[];
    const box = (item: Node) => BOX_TEXT.exec(((item.content?.[0] as Node | undefined)?.content?.[0] as Node | undefined)?.text ?? "");
    if (!items.some(box)) return next;
    return {
      type: "taskList",
      content: items.map((item) => {
        const found = box(item);
        if (!found) return { ...item, type: "taskItem", attrs: { checked: false } };
        const [line, ...below] = item.content as Node[];
        const [first, ...inline] = line.content as Node[];
        const left = (first.text ?? "").slice(found[0].length);
        return {
          type: "taskItem",
          attrs: { checked: found[1] !== " " },
          content: [{ ...line, content: left ? [{ ...first, text: left }, ...inline] : inline }, ...below],
        };
      }),
    };
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
  // "- []" is a checkbox to the eye but not to Markdown, which wants "- [ ]".
  const source = markdown.trim().replace(/^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[\](?=[ \t]|$)/gm, "$1[ ]");
  const doc = fromMarkdown(source, { breaks: true }).content;
  let blocks = tidyLists((doc.content ?? []) as Node[]);
  const only = blocks.length === 1 ? blocks[0] : null;
  const items = into && only && isWriteList(only.type) ? joinItems(only, into) : null;
  if (items && into) blocks = [{ type: into, content: items }];
  const inline = only?.type === "paragraph" ? ((only.content ?? []) as DocContent[]) : null;
  return { blocks, inline, items };
}
