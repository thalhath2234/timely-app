"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { generateHTML, type Editor, type JSONContent } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ArrowUp, RotateCcw, Sparkles, X } from "lucide-react";
import {
  PROVIDER_NOT_CHOSEN,
  SELECTION_ACTIONS,
  WRITE_BUSY,
  WRITE_EMPTY,
  WRITE_MAX_PROMPT,
  belowFit,
  blocksSummary,
  isWriteList,
  liveBlockIndex,
  replaceFit,
  replacesAll,
  selectionTooLong,
  shortenedNote,
  spotList,
  writeCursorMark,
  writeStarters,
  writeTooLong,
  writtenContent,
  type WriteAction,
  type WriteChoice,
  type WriteKind,
  type WriteList,
  type WritePlace,
  type WriteResult,
} from "@timely/contract/helpMeWrite";
import Link from "next/link";
import Button, { buttonClass } from "@/app/_components/_ui/button";
import { Input, Textarea, popoverSurface } from "@/app/_components/_ui/field";
import { ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { readyProviders } from "@/app/_components/chat/modelMenu";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { helpMeWrite } from "@/app/utils/api/write";
import { errorCode } from "@/app/utils/api/codedError";
import { useAgentProviders } from "@/app/utils/hooks/agentProviders";
import { cn } from "@/app/utils/cn";
import { captureSelection, findBlocks, placeBelow, placeBlocks, placeReplace, plainBetween, type Captured } from "./writeRange";

/** What the editor holds, so the draft fits it. */
export type WriteContext = { kind: WriteKind; title?: string };

const PANEL_WIDTH = 460;

/** The answer as editor nodes (the contract types them loosely). */
const toNodes = (markdown: string, into?: WriteList | null) =>
  writtenContent(markdown, into) as { blocks: JSONContent[]; inline: JSONContent[] | null; items: JSONContent[] | null };

/** A list a draft written at the caret joins as more items: `at` is where
 * they go inside it, and `drop` the empty item or line they take the place
 * of. `at` never comes after `drop`. */
type ListSpot = { list: WriteList; at: number; drop?: { from: number; to: number } };

const isEmptyLine = (node: PMNode | null | undefined) => Boolean(node?.isTextblock && node.content.size === 0);

/** Whether only empty lines follow the top-level block `pos` is in. The
 * phone editor's writeInfo works out the same (atEnd). */
function caretAtEnd(doc: PMNode, pos: number) {
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  for (let i = $pos.depth > 0 ? $pos.index(0) + 1 : doc.childCount; i < doc.childCount; i++) {
    if (!isEmptyLine(doc.child(i))) return false;
  }
  return true;
}

/** Drafts that add to the text where they go: written at the caret, or
 * Continue writing at the end. */
const joinsList = (action: WriteAction) => action === "write" || action === "continue";

/** The list a draft at `pos` joins: the list the caret is in (after its item,
 * or over it when the item is empty), or the list right above an empty line,
 * which is where Enter twice leaves the caret. With `end` (Continue writing)
 * it is the list the doc ends with. The phone editor mirrors this (listSpot
 * in apps/mobile/components/editor/editorHtml.ts). */
function listSpot(doc: PMNode, pos: number, end: boolean): ListSpot | null {
  if (end) {
    let index = doc.childCount - 1;
    let at = doc.content.size;
    let drop: ListSpot["drop"];
    if (index > 0 && isEmptyLine(doc.child(index))) {
      drop = { from: at - doc.child(index).nodeSize, to: at };
      at = drop.from;
      index -= 1;
    }
    const last = doc.child(index);
    return isWriteList(last.type.name) ? { list: last.type.name, at: at - 1, drop } : null;
  }
  const $pos = doc.resolve(Math.min(pos, doc.content.size));
  for (let depth = $pos.depth; depth > 1; depth--) {
    const item = $pos.node(depth);
    const list = $pos.node(depth - 1).type.name;
    if ((item.type.name === "taskItem" || item.type.name === "listItem") && isWriteList(list)) {
      if (item.childCount === 1 && isEmptyLine(item.firstChild)) {
        return { list, at: $pos.before(depth), drop: { from: $pos.before(depth), to: $pos.after(depth) } };
      }
      return { list, at: $pos.after(depth) };
    }
  }
  if ($pos.depth > 0 && isEmptyLine($pos.parent)) {
    const index = $pos.index($pos.depth - 1);
    const above = index > 0 ? $pos.node($pos.depth - 1).child(index - 1) : null;
    if (above && isWriteList(above.type.name)) {
      return { list: above.type.name, at: $pos.before() - 1, drop: { from: $pos.before(), to: $pos.after() } };
    }
  }
  return null;
}

/** The doc as the AI reads it: `mark` (writeCursorMark) typed where a draft
 * written at `pos` goes, as a new item when it joins a list. `added` is the
 * index of the line the cursor went on when that line is new, so blocks the
 * AI names by their index in this doc are found in the editor
 * (liveBlockIndex). */
function cursorDoc(state: EditorState, pos: number, mark: string): { doc: JSONContent; added: number | null } {
  const { tr, schema } = state;
  let added: number | null = null;
  try {
    const spot = listSpot(state.doc, pos, false);
    if (spot) {
      const item = schema.nodes[spot.list === "taskList" ? "taskItem" : "listItem"];
      const marked = item.create(null, schema.nodes.paragraph.create(null, schema.text(mark)));
      if (spot.drop && spot.drop.from === spot.at) tr.replaceWith(spot.drop.from, spot.drop.to, marked);
      else {
        if (spot.drop) tr.delete(spot.drop.from, spot.drop.to);
        tr.insert(spot.at, marked);
      }
    } else {
      const $pos = state.doc.resolve(Math.min(pos, state.doc.content.size));
      // Only an empty line of its own becomes the draft (insert does the
      // same); in a table cell or callout the draft goes after the block.
      if ($pos.depth === 1 && isEmptyLine($pos.parent)) tr.insertText(mark, $pos.pos);
      else {
        added = $pos.depth > 0 ? $pos.index(0) + 1 : state.doc.childCount;
        tr.insert($pos.depth > 0 ? $pos.after(1) : state.doc.content.size, schema.nodes.paragraph.create(null, schema.text(mark)));
      }
    }
    return { doc: tr.doc.toJSON(), added };
  } catch {
    // Where the cursor cannot go, the AI reads the doc without it.
    return { doc: state.doc.toJSON(), added: null };
  }
}

/** The draft's pictures as words in the preview: a picture loads only once
 * the draft is inserted, so a draft can't make the browser call an address
 * it names just by being shown. */
function withoutImages(nodes: JSONContent[]): JSONContent[] {
  return nodes.map((node) => {
    if (node.type === "image") {
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt.trim() : "";
      let from = "";
      try {
        from = new URL(String(node.attrs?.src ?? ""), window.location.href).host;
      } catch {
        // no address to name
      }
      // In italics, so it reads as a stand-in rather than words of the draft.
      return { type: "text", text: alt ? `[Image: ${alt}]` : from ? `[Image from ${from}]` : "[Image]", marks: [{ type: "italic" }] };
    }
    return node.content ? { ...node, content: withoutImages(node.content) } : node;
  });
}

/** Help me write needs a generative AI provider (Settings → Agent keys);
 * TypeSafe alone only answers typed questions, so it does not count. */
export function useHelpMeWriteAvailable() {
  const { data } = useAgentProviders();
  return readyProviders(data).length > 0;
}

/** The labelled toolbar entry. It sits first in the bar, so it is never lost
 * among the formatting icons. */
export function HelpMeWriteButton({
  active,
  kept,
  onClick,
  compact,
}: {
  active: boolean;
  /** A prompt or draft is waiting in the closed panel; a dot says so. */
  kept?: boolean;
  onClick: (anchor: DOMRect) => void;
  compact?: boolean;
}) {
  const dot = kept && !active && (
    <span aria-hidden="true" className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-card" />
  );
  const label = kept && !active ? "Help me write, draft waiting" : "Help me write";
  // Icon only in the doc page's toolbar rail, which is one button wide.
  if (compact) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={active}
        onClick={(event) => onClick(event.currentTarget.getBoundingClientRect())}
        className={cn(
          "relative flex size-7 shrink-0 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary/15",
          active && "bg-primary/15",
        )}
      >
        <Sparkles className="size-3.5" />
        {dot}
      </button>
    );
  }
  return (
    <Button
      variant="soft"
      size="sm"
      aria-haspopup="dialog"
      aria-expanded={active}
      leading={<Sparkles />}
      aria-label={label}
      onClick={(event) => onClick(event.currentTarget.getBoundingClientRect())}
      className={cn("relative font-semibold", active && "bg-primary/15")}
    >
      Help me write
      {dot}
    </Button>
  );
}

/** `place`: the action whose spot the draft takes, when it is not `action`.
 * Ask for changes rewrites a draft as "write", but a refined summary still
 * goes where a summary goes, and refined Continue writing still goes at the
 * end. */
type Run = {
  action: WriteAction;
  place?: WriteAction;
  prompt?: string;
  selection?: string;
  label?: string;
  /** A typed request: the AI also says where the draft goes. */
  ask?: boolean;
  /** Where the draft being changed goes (Ask for changes keeps it). */
  where?: Where;
};
const placeOf = (run: Run) => run.place ?? run.action;

/** Where the AI said a draft goes. `blocks`: the doc's top-level blocks it
 * replaces, as the AI read them, and the index they were at. */
type Where = { mode: WritePlace["mode"]; blocks?: { nodes: PMNode[]; index: number } };

/** The AI's place for an answer, read against the doc it was written from
 * (`sent`, with the cursor line `added`). Blocks it names that the doc did
 * not hold are no place. */
function whereOf(place: WritePlace | undefined, doc: PMNode, added: number | null, hasSelection: boolean): Where | undefined {
  if (!place) return undefined;
  if (hasSelection) return place.mode === "replace" || place.mode === "below" ? { mode: place.mode } : undefined;
  if (place.mode === "cursor" || place.mode === "end") return { mode: place.mode };
  if (place.mode !== "replace" || place.from == null || place.to == null) return undefined;
  const from = liveBlockIndex(place.from, added);
  const to = liveBlockIndex(place.to, added);
  if (from < 0 || to < from || to >= doc.childCount) return undefined;
  const nodes: PMNode[] = [];
  for (let i = from; i <= to; i++) nodes.push(doc.child(i));
  return { mode: "replace", blocks: { nodes, index: from } };
}

/** Where the draft will go, kept in step with edits made while the panel
 * stays open, and the lines there marked while it shows. `replace`: the
 * blocks a draft will take the place of, when the AI chose them; they are
 * marked instead of the caret's line. */
type Range = { from: number; to: number };
type Target = Range & { show: boolean; replace?: Range | null };
type TargetMeta = { show?: boolean; replace?: Range | null };
const targetKey = new PluginKey<Target>("helpMeWriteTarget");
const targetPlugin = (start: Target) =>
  new Plugin<Target>({
    key: targetKey,
    state: {
      init: () => start,
      apply: (tr, value) => {
        const meta = tr.getMeta(targetKey) as TargetMeta | undefined;
        let next = meta ? { ...value, ...meta } : value;
        if (tr.docChanged) {
          const caret = next.from === next.to;
          const from = tr.mapping.map(next.from, caret ? -1 : 1);
          next = { ...next, from, to: caret ? from : Math.max(from, tr.mapping.map(next.to, -1)) };
          if (next.replace) {
            const start = tr.mapping.map(next.replace.from, 1);
            next.replace = { from: start, to: Math.max(start, tr.mapping.map(next.replace.to, -1)) };
          }
        }
        return next;
      },
    },
    props: {
      decorations: (state) => {
        const target = targetKey.getState(state);
        if (!target?.show) return null;
        const size = state.doc.content.size;
        const marks: Decoration[] = [];
        if (target.replace && target.replace.to > target.replace.from) {
          // Whole blocks, each marked as one.
          state.doc.nodesBetween(Math.min(target.replace.from, size), Math.min(target.replace.to, size), (node, pos) => {
            if (marks.length < 40 && node.content.size > 0) marks.push(Decoration.node(pos, pos + node.nodeSize, { class: "doc-line-hinted" }));
            return false;
          });
          return DecorationSet.create(state.doc, marks);
        }
        state.doc.nodesBetween(Math.min(target.from, size), Math.min(Math.max(target.to, target.from + 1), size), (node, pos) => {
          if (!node.isTextblock) return true;
          if (marks.length < 40) marks.push(Decoration.node(pos, pos + node.nodeSize, { class: "doc-line-hinted" }));
          return false;
        });
        return DecorationSet.create(state.doc, marks);
      },
    },
  });

export default function HelpMeWritePanel({
  editor,
  context,
  anchor,
  shown,
  dock,
  onHide,
  onDone,
}: {
  editor: Editor;
  context: WriteContext;
  /** Screen point the panel hangs from (the toolbar button or the caret). */
  anchor: { top: number; left: number };
  /** Closing only hides the panel while it holds a prompt or a draft, so
   * opening it again picks up where it was. */
  shown: boolean;
  /** The doc page's right margin on a wide page: the panel sits there level
   * with the line it writes into and stays open while the doc is edited. */
  dock?: HTMLElement | null;
  /** Closed with X, Escape or a click outside; `keep` when there is a prompt
   * or a draft to come back to. */
  onHide: (keep: boolean) => void;
  /** The draft went into the doc. */
  onDone: () => void;
}) {
  // The selection when the panel opened; focus moves into the panel after this.
  const [captured] = useState<Captured>(() => captureSelection(editor.state));
  const hasSelection = captured.text !== "";
  const docText = () => editor.getText({ blockSeparator: "\n" }).trim();
  const [hasText] = useState(() => docText() !== "");
  const choices: WriteChoice[] = hasSelection ? SELECTION_ACTIONS : writeStarters(context.kind, hasText);

  const [prompt, setPrompt] = useState("");
  const [refine, setRefine] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // The account has providers but none is chosen (ADR 0020): offer the fix.
  const [needsChoice, setNeedsChoice] = useState(false);
  // `list`: the list the draft joins, so the preview shows it as that list;
  // `where`: where the AI said it goes.
  const [result, setResult] = useState<(WriteResult & { run: Run; list?: WriteList; where?: Where }) | null>(null);
  const abort = useRef<AbortController | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchor.top);
  const docked = Boolean(dock);
  const keep = Boolean(prompt.trim() || refine.trim() || result || busy);
  const hide = () => onHide(keep);
  const hideRef = useRef(hide);
  useLayoutEffect(() => {
    hideRef.current = hide;
  });

  // The target follows edits for as long as the panel lives.
  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.registerPlugin(targetPlugin({ from: captured.from, to: captured.to, show: false }));
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(targetKey);
    };
  }, [editor, captured]);
  useEffect(() => {
    if (editor.isDestroyed || !targetKey.getState(editor.state)) return;
    editor.view.dispatch(editor.state.tr.setMeta(targetKey, { show: shown } satisfies TargetMeta).setMeta("addToHistory", false));
  }, [editor, shown]);

  // The blocks a discarded draft would have replaced are no longer marked.
  const replacing = Boolean(result?.where?.blocks);
  useEffect(() => {
    if (replacing || editor.isDestroyed || !targetKey.getState(editor.state)?.replace) return;
    editor.view.dispatch(editor.state.tr.setMeta(targetKey, { replace: null } satisfies TargetMeta).setMeta("addToHistory", false));
  }, [editor, replacing]);

  // A draft still being written finishes while the panel is hidden; only
  // leaving the editor stops it.
  useEffect(() => () => abort.current?.abort(), []);

  // Keep the panel on screen: below the anchor when it fits, else pinned to
  // the bottom edge.
  useLayoutEffect(() => {
    if (docked || !shown) return;
    const height = panel.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(anchor.top, window.innerHeight - height - 12)));
  }, [anchor.top, busy, result, error, docked, shown]);

  // Docked: level with the target line, following it as the doc changes.
  useLayoutEffect(() => {
    if (!dock || !shown) return;
    let frame = 0;
    const place = () => {
      const target = targetKey.getState(editor.state);
      if (!target || editor.isDestroyed) return;
      const at = target.replace ? target.replace.from + 1 : target.from;
      const line = editor.view.coordsAtPos(Math.min(at, editor.state.doc.content.size));
      setTop(Math.max(0, Math.round(line.top - dock.getBoundingClientRect().top - 10)));
    };
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    editor.on("update", soon);
    const observer = new ResizeObserver(soon);
    observer.observe(editor.view.dom);
    observer.observe(dock);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("update", soon);
      observer.disconnect();
    };
  }, [editor, dock, shown, result]);
  // Docked beside a line low on the page, the draft's buttons would sit
  // below the fold: bring the whole panel into view when it opens and when a
  // draft or an error arrives.
  useEffect(() => {
    if (docked && shown) panel.current?.scrollIntoView({ block: "nearest" });
  }, [docked, shown, result, error]);

  // Escape closes the popover from anywhere; the docked panel only when the
  // key is pressed inside it, so Escape in the doc leaves it be.
  useEffect(() => {
    if (!shown || docked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hideRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, docked]);

  // Where the panel opened, moved along with any edits made since.
  const caret = () => targetKey.getState(editor.state)?.from ?? captured.from;
  // The list a draft written with nothing selected joins, if any. A summary
  // or description is not more items of the list the caret is in.
  const spotFor = (action: WriteAction) =>
    hasSelection || !joinsList(action) ? null : listSpot(editor.state.doc, caret(), action === "continue");
  // The action whose spot a draft takes: the end, where the AI put it there,
  // goes where Continue writing goes.
  const spotAction = (run: Run, where?: Where) => (where?.mode === "end" ? "continue" : placeOf(run));
  // The list the draft is read into: the selection's, none for blocks it
  // replaces (it is their new version), else the list it joins.
  const listFor = (run: Run, where?: Where) =>
    hasSelection ? spotList(captured.spot) ?? undefined : where?.blocks ? undefined : spotFor(spotAction(run, where))?.list;

  const start = async (run: Run) => {
    abort.current?.abort();
    // Rewriting only part of a long selection would let Replace delete the
    // rest, so it is refused here before anything is sent (the API refuses
    // it too).
    if (!run.selection && hasSelection && selectionTooLong(captured.text)) {
      setError(writeTooLong(run.action));
      return;
    }
    const mark = writeCursorMark();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(run.label ?? WRITE_BUSY[run.action]);
    setError("");
    setNeedsChoice(false);
    // The doc as it is now: blocks the AI names are taken from it.
    const before = editor.state.doc;
    const sent = hasSelection || run.action !== "write" ? { doc: editor.getJSON(), added: null } : cursorDoc(editor.state, caret(), mark);
    try {
      const out = await helpMeWrite(
        {
          action: run.action,
          prompt: run.prompt,
          selection: run.selection ?? (captured.text || undefined),
          // "Ask for changes" rewrites the draft, which is already Markdown.
          selectionDoc: run.selection ? undefined : captured.doc,
          kind: context.kind,
          title: context.title,
          text: docText(),
          doc: sent.doc,
          cursorMark: mark,
          place: run.ask || undefined,
        },
        controller.signal,
      );
      const where = run.where ?? (run.ask ? whereOf(out.place, before, sent.added, hasSelection) : undefined);
      const list = listFor(run, where);
      // An answer with nothing to insert ("- [ ]" alone) is an empty answer,
      // not a blank draft whose Insert does nothing.
      if (!toNodes(out.text, list).blocks.length) {
        setError(WRITE_EMPTY);
        return;
      }
      // The blocks it replaces are marked in the doc, and a docked panel
      // moves level with them.
      const found = where?.blocks ? findBlocks(editor.state.doc, where.blocks.nodes, where.blocks.index) : null;
      editor.view.dispatch(
        editor.state.tr.setMeta(targetKey, { replace: found ? { from: found.from, to: found.to } : null } satisfies TargetMeta).setMeta("addToHistory", false),
      );
      setResult({ ...out, run, list, where: where?.blocks && !found ? undefined : where });
      setRefine("");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Could not write that. Try again.");
      setNeedsChoice(errorCode(err) === PROVIDER_NOT_CHOSEN);
    } finally {
      if (abort.current === controller) setBusy(null);
    }
  };

  const submitPrompt = () => {
    const text = prompt.trim();
    if (text) void start({ action: "write", prompt: text, ask: true });
  };

  // "Ask for changes" rewrites the draft itself, which still goes where the
  // first one was going.
  const submitRefine = () => {
    const text = refine.trim();
    if (!text || !result) return;
    void start({ action: "write", place: placeOf(result.run), prompt: text, selection: result.text, label: "Updating the draft", where: result.where });
  };

  const preview = useMemo(() => {
    if (!result) return "";
    const { blocks } = toNodes(result.text, result.list);
    try {
      // Links and checkboxes in the preview are for looking at, so they are
      // left out of the tab order as well as out of reach of the pointer.
      return generateHTML({ type: "doc", content: withoutImages(blocks) }, editor.extensionManager.extensions)
        .replace(/<(a|input)\b/g, '<$1 tabindex="-1"');
    } catch {
      return "";
    }
  }, [editor, result]);

  // How the draft can replace the selection; null: only Insert below. The
  // doc's own rules have the last word (a details summary line or a code
  // block takes no formatting), so Replace is only offered where it would go.
  const fit = useMemo(() => {
    if (!result || !hasSelection || !captured.spot) return null;
    const written = toNodes(result.text, spotList(captured.spot));
    const how = replaceFit(captured.spot, written);
    if (!how) return null;
    const mapped = targetKey.getState(editor.state);
    try {
      return placeReplace(editor.state, { from: mapped?.from ?? captured.from, to: mapped?.to ?? captured.to }, how, written) ? how : null;
    } catch {
      return null;
    }
  }, [editor, result, hasSelection, captured]);
  // "Rewrite description" writes a whole new one: it replaces the old one,
  // or goes below it, instead of landing inside it at the caret.
  const wholeDescription = Boolean(result && !hasSelection && replacesAll(context.kind, placeOf(result.run), hasText));

  /** The selected text's draft goes over the selection or below it, never
   * over more than was sent. */
  const insertForSelection = (mode: "replace" | "below", target: { from: number; to: number }) => {
    const spot = captured.spot;
    if (!result || !spot) return false;
    const written = toNodes(result.text, spotList(spot));
    const tr =
      mode === "replace"
        ? placeReplace(editor.state, target, fit, written)
        : placeBelow(editor.state, target, belowFit(spot, written), written);
    if (!tr) return false;
    editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
    return true;
  };

  /** A draft the AI said takes the place of whole blocks goes over them, or
   * below them, only while they are as it read them. */
  const insertForBlocks = (mode: "replace" | "below", target: NonNullable<Where["blocks"]>) => {
    if (!result) return;
    const range = findBlocks(editor.state.doc, target.nodes, target.index);
    if (!range) {
      useToastStore.getState().show("Those lines changed while the AI was writing. Try again.");
      return;
    }
    const tr = placeBlocks(editor.state, mode === "replace" ? range : { from: range.to, to: range.to }, toNodes(result.text).blocks);
    if (!tr) {
      useToastStore.getState().show("This draft can't go there. Try again.");
      return;
    }
    editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
    if (mode === "replace") {
      showUndoToast(`Replaced ${blocksSummary(target.nodes.map((node) => node.toJSON()))}`, () => {
        if (!editor.isDestroyed) editor.commands.undo();
      });
    }
    onDone();
  };

  /** "replace" and "below" are the panel's main and second buttons for a
   * selection, blocks or a whole description, and "replace" is Insert
   * otherwise; "cursor" and "end" put a draft the AI meant for the end at
   * the caret or at the end. */
  const insert = (mode: "replace" | "below" | "cursor" | "end") => {
    if (!result) return;
    const blocksTarget = hasSelection ? undefined : result.where?.blocks;
    if (blocksTarget && (mode === "replace" || mode === "below")) {
      insertForBlocks(mode, blocksTarget);
      return;
    }
    const place = mode === "end" ? "continue" : mode === "cursor" ? "write" : spotAction(result.run, result.where);
    const spot = spotFor(place);
    const { blocks, items } = toNodes(result.text, spot?.list);
    if (blocks.length === 0) return;
    const { doc } = editor.state;
    // Where the panel opened, moved along with any edits made since.
    const mapped = targetKey.getState(editor.state);
    const target = { ...captured, from: mapped?.from ?? captured.from, to: mapped?.to ?? captured.to };
    const size = doc.content.size;
    const chain = editor.chain().focus();
    if (hasSelection && (target.to > size || plainBetween(doc, target.from, target.to) !== captured.text)) {
      useToastStore.getState().show("The text changed while writing. Select it again.");
      return;
    }
    if (hasSelection) {
      if (!insertForSelection(mode === "below" ? "below" : "replace", target)) {
        useToastStore.getState().show("This draft can't take the place of your selection. Use Insert below.");
        return;
      }
    } else if (wholeDescription) {
      chain.insertContentAt(mode === "replace" ? { from: 0, to: size } : size, blocks).run();
    } else if (spot && items) {
      // The items join the list, after the caret's item or in place of the
      // empty item or line the caret is on.
      const { at, drop } = spot;
      if (drop?.from === at) chain.insertContentAt(drop, items).run();
      else if (drop) chain.deleteRange(drop).insertContentAt(at, items).run();
      else chain.insertContentAt(at, items).run();
    } else if (place === "continue") {
      chain.insertContentAt(size, blocks).run();
    } else {
      const at = doc.resolve(Math.min(target.from, size));
      const block = at.depth > 0 ? at.node(1) : null;
      if (block?.isTextblock && block.content.size === 0) {
        // An empty line becomes the draft.
        chain.insertContentAt({ from: at.before(1), to: at.after(1) }, blocks).run();
      } else if (at.depth > 0) {
        chain.insertContentAt(at.after(1), blocks).run();
      } else {
        chain.insertContentAt(size, blocks).run();
      }
    }
    onDone();
  };

  const subtitle = hasSelection ? "Rewrite the selected text" : context.kind === "doc" ? "Draft into this doc" : "Draft the description";

  // Where the AI put the draft, in words, above it.
  const blocksTarget = result && !hasSelection ? result.where?.blocks : undefined;
  const belowFirst = hasSelection && (result?.where?.mode === "below" || !fit);
  const placeRow = !result?.where
    ? null
    : blocksTarget
      ? { label: "Replaces", value: blocksSummary(blocksTarget.nodes.map((node) => node.toJSON())) }
      : hasSelection
        ? belowFirst
          ? { label: "Adds", value: "Below your selection" }
          : { label: "Replaces", value: "Your selection" }
        : result.where.mode === "end"
          ? { label: "Adds", value: context.kind === "doc" ? "At the end of the doc" : "At the end" }
          : { label: "Adds", value: "At the cursor" };
  // A draft for the end can still go at the caret, unless the caret is at
  // the end already (only empty lines after its block).
  const endChoice = Boolean(result?.where?.mode === "end" && !hasSelection && !wholeDescription && !caretAtEnd(editor.state.doc, caret()));
  // Two buttons on the right leave no room for "Try again" in words in the
  // docked panel, which is as narrow as the doc's margin.
  const twoActions = belowFirst ? Boolean(fit) : endChoice || Boolean(hasSelection || wholeDescription || blocksTarget);
  const compactFooter = docked && twoActions;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - PANEL_WIDTH - 8));

  if (!shown) return null;
  const surface = (
      <div
        ref={panel}
        role="dialog"
        aria-label="Help me write"
        className={cn(
          popoverSurface,
          "flex max-h-[min(560px,calc(100vh-24px))] flex-col overflow-hidden",
          docked ? "absolute inset-x-0 z-30" : "fixed z-[60]",
        )}
        style={docked ? { top } : { top, left, width: `min(${PANEL_WIDTH}px, calc(100vw - 16px))` }}
        onKeyDown={(event) => {
          if (docked && event.key === "Escape") {
            event.preventDefault();
            hide();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="flex size-6 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Sparkles className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Help me write</p>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <Button variant="ghost" size="sm" icon aria-label="Close" onClick={hide}>
            <X />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {hasSelection && !result && (
            <p className="line-clamp-3 border-l-2 border-primary/40 pl-2.5 text-xs leading-relaxed text-muted-foreground">
              {captured.text}
            </p>
          )}

          {busy ? (
            <div className="flex items-center gap-2.5 rounded-md bg-muted/40 px-3 py-6 text-sm text-muted-foreground" aria-live="polite">
              <LogoSpinner size={16} label={busy} />
              <span className="flex-1">{busy}…</span>
              <Button variant="ghost" size="sm" onClick={() => { abort.current?.abort(); setBusy(null); }}>
                Stop
              </Button>
            </div>
          ) : result ? (
            <>
              {result.shortened && <p className="text-xs leading-relaxed text-muted-foreground">{shortenedNote(context.kind)}</p>}
              {placeRow && (
                <ListGroup>
                  <ListRow label={placeRow.label}>
                    <span className="truncate text-[13px] font-medium text-muted-foreground">{placeRow.value}</span>
                  </ListRow>
                </ListGroup>
              )}
              <div
                // The preview must take pointer events or the wheel, trackpad and
                // scrollbar can't scroll it; only the links and checkboxes inside
                // are switched off so the draft can't be clicked into.
                className="doc-editor-content doc-editor-compact max-h-72 overflow-y-auto overscroll-contain rounded-md border border-border bg-background/60 px-3 py-2 text-sm [&_a]:pointer-events-none [&_input]:pointer-events-none [&_label]:pointer-events-none"
                tabIndex={0}
                role="region"
                aria-label="Draft preview"
                // generateHTML serialises through the editor schema, which escapes text.
                dangerouslySetInnerHTML={{ __html: preview }}
              />
              {hasSelection && !fit && result.where?.mode !== "below" && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  This draft can&rsquo;t take the place of your selection, so it goes below it.
                </p>
              )}
              <form
                className="flex items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitRefine();
                }}
              >
                <Input
                  size="sm"
                  value={refine}
                  onChange={(event) => setRefine(event.target.value)}
                  placeholder="Ask for changes, like “more casual”"
                  aria-label="Ask for changes"
                />
                <Button type="submit" variant="ghost" size="sm" icon aria-label="Update the draft" disabled={!refine.trim()}>
                  <ArrowUp />
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {choices.map((choice) => (
                  <Button
                    key={choice.label}
                    variant="outline"
                    size="sm"
                    onClick={() => void start({ action: choice.action, prompt: choice.prompt })}
                  >
                    {choice.label}
                  </Button>
                ))}
              </div>
              <form
                className="flex flex-col gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitPrompt();
                }}
              >
                <label htmlFor="help-me-write-prompt" className="text-xs font-medium text-muted-foreground">
                  {hasSelection ? "Or say how to change it" : "Or say what to write"}
                </label>
                <div className="relative">
                  <Textarea
                    id="help-me-write-prompt"
                    autoFocus
                    rows={2}
                    maxLength={WRITE_MAX_PROMPT}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        submitPrompt();
                      }
                    }}
                    placeholder={
                      hasSelection
                        ? "Make it friendlier, translate to Spanish…"
                        : context.kind === "doc"
                          ? "A packing list for two days in Lisbon…"
                          : "What done looks like, and who to ask…"
                    }
                    className="min-h-16 resize-none pr-10"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    icon
                    aria-label="Write"
                    disabled={!prompt.trim()}
                    className="absolute right-1.5 bottom-1.5"
                  >
                    <ArrowUp />
                  </Button>
                </div>
              </form>
            </>
          )}

          {error && (
            <div
              role="alert"
              className={cn(
                "flex flex-col items-start gap-2 rounded-md px-2.5 py-2 text-xs",
                needsChoice ? "border border-border bg-muted/60 text-foreground" : "bg-destructive/10 text-destructive",
              )}
            >
              <p>{error}</p>
              {needsChoice && (
                <Link href="/settings?tab=agent" className={buttonClass({ size: "sm", variant: "outline" })}>
                  Choose provider
                </Link>
              )}
            </div>
          )}
        </div>

        {result && !busy && (
          <div className="flex items-center gap-1.5 border-t border-border px-3 py-2">
            {compactFooter ? (
              <Button variant="ghost" size="sm" icon aria-label="Try again" title="Try again" onClick={() => void start(result.run)}>
                <RotateCcw />
              </Button>
            ) : (
              <Button variant="ghost" size="sm" leading={<RotateCcw />} onClick={() => void start(result.run)}>
                Try again
              </Button>
            )}
            <Button variant="destructive-ghost" size="sm" onClick={() => setResult(null)}>
              Discard
            </Button>
            <span className="flex-1" />
            {hasSelection && belowFirst ? (
              <>
                {fit && (
                  <Button variant="outline" size="sm" onClick={() => insert("replace")}>
                    Replace
                  </Button>
                )}
                <Button size="sm" onClick={() => insert("below")}>
                  Insert below
                </Button>
              </>
            ) : endChoice ? (
              <>
                <Button variant="outline" size="sm" onClick={() => insert("cursor")}>
                  At cursor
                </Button>
                <Button size="sm" onClick={() => insert("end")}>
                  Add at end
                </Button>
              </>
            ) : (
              <>
                {(hasSelection || wholeDescription || blocksTarget) && (
                  <Button variant="outline" size="sm" onClick={() => insert("below")}>
                    Insert below
                  </Button>
                )}
                {/* A draft for the end, with the caret at the end already,
                    takes the caret's empty line like any draft there. */}
                <Button size="sm" onClick={() => insert(result.where?.mode === "end" && !wholeDescription ? "cursor" : "replace")}>
                  {hasSelection || wholeDescription || blocksTarget ? "Replace" : "Insert"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
  );
  if (dock) return createPortal(surface, dock);
  return (
    <>
      <div className="fixed inset-0 z-50" onMouseDown={hide} />
      {surface}
    </>
  );
}
