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
  text?: string;
};

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

/** Turns a Markdown answer into blocks to insert. A one-paragraph answer comes
 * back as inline content so it can replace words inside a line. */
export function writtenContent(markdown: string): { blocks: DocContent[]; inline: DocContent[] | null } {
  const doc = fromMarkdown(markdown.trim(), { breaks: true }).content;
  const blocks = (doc.content ?? []) as DocContent[];
  const only = blocks.length === 1 ? blocks[0] : null;
  const inline = only?.type === "paragraph" ? ((only.content ?? []) as DocContent[]) : null;
  return { blocks, inline };
}
