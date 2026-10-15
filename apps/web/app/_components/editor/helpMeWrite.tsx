"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { generateHTML, type Editor, type JSONContent } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { ArrowUp, RotateCcw, Sparkles, X } from "lucide-react";
import {
  SELECTION_ACTIONS,
  WRITE_BUSY,
  writeStarters,
  writtenContent,
  type WriteAction,
  type WriteChoice,
  type WriteKind,
  type WriteResult,
} from "@timely/contract/helpMeWrite";
import Button from "@/app/_components/_ui/button";
import { Input, Textarea, popoverSurface } from "@/app/_components/_ui/field";
import { LogoSpinner } from "@/app/_components/_ui/timelyLogo";
import { readyProviders } from "@/app/_components/chat/modelMenu";
import { useToastStore } from "@/app/_store/toastStore";
import { helpMeWrite } from "@/app/utils/api/write";
import { useAgentProviders } from "@/app/utils/hooks/agentProviders";
import { cn } from "@/app/utils/cn";

/** What the editor holds, so the draft fits it. */
export type WriteContext = { kind: WriteKind; title?: string };

const PANEL_WIDTH = 460;

/** The answer as editor nodes (the contract types them loosely). */
const toNodes = (markdown: string) =>
  writtenContent(markdown) as { blocks: JSONContent[]; inline: JSONContent[] | null };

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

type Captured = { from: number; to: number; text: string };

/** The list item a one-line selection sits in, with its list's type. */
function enclosingListItem(editor: Editor, range: Captured) {
  const { doc } = editor.state;
  const $from = doc.resolve(range.from);
  if (!$from.sameParent(doc.resolve(range.to))) return null;
  for (let depth = $from.depth; depth > 1; depth--) {
    const name = $from.node(depth).type.name;
    if (name === "listItem" || name === "taskItem") {
      return { from: $from.before(depth), to: $from.after(depth), listType: $from.node(depth - 1).type.name };
    }
  }
  return null;
}
type Run = { action: WriteAction; prompt?: string; selection?: string; label?: string };

/** Where the draft will go, kept in step with edits made while the panel
 * stays open, and the lines there marked while it shows. */
type Target = { from: number; to: number; show: boolean };
const targetKey = new PluginKey<Target>("helpMeWriteTarget");
const targetPlugin = (start: Target) =>
  new Plugin<Target>({
    key: targetKey,
    state: {
      init: () => start,
      apply: (tr, value) => {
        const show = tr.getMeta(targetKey) as boolean | undefined;
        let next = show === undefined ? value : { ...value, show };
        if (tr.docChanged) {
          const caret = next.from === next.to;
          const from = tr.mapping.map(next.from, caret ? -1 : 1);
          next = { ...next, from, to: caret ? from : Math.max(from, tr.mapping.map(next.to, -1)) };
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
  const [captured] = useState<Captured>(() => {
    const { from, to } = editor.state.selection;
    return { from, to, text: from === to ? "" : editor.state.doc.textBetween(from, to, "\n").trim() };
  });
  const hasSelection = captured.text !== "";
  const docText = () => editor.getText({ blockSeparator: "\n" }).trim();
  const [hasText] = useState(() => docText() !== "");
  const choices: WriteChoice[] = hasSelection ? SELECTION_ACTIONS : writeStarters(context.kind, hasText);

  const [prompt, setPrompt] = useState("");
  const [refine, setRefine] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<(WriteResult & { run: Run }) | null>(null);
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
    editor.view.dispatch(editor.state.tr.setMeta(targetKey, shown).setMeta("addToHistory", false));
  }, [editor, shown]);

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
      const line = editor.view.coordsAtPos(Math.min(target.from, editor.state.doc.content.size));
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
  }, [editor, dock, shown]);
  useEffect(() => {
    if (docked && shown) panel.current?.scrollIntoView({ block: "nearest" });
  }, [docked, shown]);

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

  const start = async (run: Run) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(run.label ?? WRITE_BUSY[run.action]);
    setError("");
    try {
      const out = await helpMeWrite(
        {
          action: run.action,
          prompt: run.prompt,
          selection: run.selection ?? (captured.text || undefined),
          kind: context.kind,
          title: context.title,
          text: docText(),
        },
        controller.signal,
      );
      setResult({ ...out, run });
      setRefine("");
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Could not write that. Try again.");
    } finally {
      if (abort.current === controller) setBusy(null);
    }
  };

  const submitPrompt = () => {
    const text = prompt.trim();
    if (text) void start({ action: "write", prompt: text });
  };

  // "Ask for changes" rewrites the draft itself.
  const submitRefine = () => {
    const text = refine.trim();
    if (!text || !result) return;
    void start({ action: "write", prompt: text, selection: result.text, label: "Updating the draft" });
  };

  const preview = useMemo(() => {
    if (!result) return "";
    const { blocks } = toNodes(result.text);
    try {
      // Links and checkboxes in the preview are for looking at, so they are
      // left out of the tab order as well as out of reach of the pointer.
      return generateHTML({ type: "doc", content: blocks }, editor.extensionManager.extensions)
        .replace(/<(a|input)\b/g, '<$1 tabindex="-1"');
    } catch {
      return "";
    }
  }, [editor, result]);

  const insert = (mode: "replace" | "below") => {
    if (!result) return;
    const { blocks, inline } = toNodes(result.text);
    if (blocks.length === 0) return;
    const { doc } = editor.state;
    // Where the panel opened, moved along with any edits made since.
    const mapped = targetKey.getState(editor.state);
    const target = { ...captured, from: mapped?.from ?? captured.from, to: mapped?.to ?? captured.to };
    const size = doc.content.size;
    const chain = editor.chain().focus();
    const replacing = hasSelection && mode === "replace";
    if (hasSelection && (target.to > size || doc.textBetween(target.from, target.to, "\n").trim() !== captured.text)) {
      useToastStore.getState().show("The text changed while writing. Select it again.");
      return;
    }
    if (replacing) {
      // A list answer for text inside a list item replaces that item, so the
      // new items sit beside it instead of nesting inside it.
      const item = !inline ? enclosingListItem(editor, target) : null;
      if (item && blocks.length === 1 && blocks[0].type === item.listType) {
        chain.insertContentAt({ from: item.from, to: item.to }, blocks[0].content ?? []).run();
      } else {
        chain.insertContentAt({ from: target.from, to: target.to }, inline ?? blocks).run();
      }
    } else if (result.run.action === "continue") {
      chain.insertContentAt(size, blocks).run();
    } else {
      const at = doc.resolve(Math.min(hasSelection ? target.to : target.from, size));
      const block = at.depth > 0 ? at.node(1) : null;
      if (!hasSelection && block?.isTextblock && block.content.size === 0) {
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

  const where = hasSelection ? "Rewrite the selected text" : context.kind === "doc" ? "Draft into this doc" : "Draft the description";
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
            <p className="truncate text-xs text-muted-foreground">{where}</p>
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
            <p role="alert" className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        {result && !busy && (
          <div className="flex items-center gap-1.5 border-t border-border px-3 py-2">
            <Button variant="ghost" size="sm" leading={<RotateCcw />} onClick={() => void start(result.run)}>
              Try again
            </Button>
            <Button variant="destructive-ghost" size="sm" onClick={() => setResult(null)}>
              Discard
            </Button>
            <span className="flex-1" />
            {hasSelection && (
              <Button variant="outline" size="sm" onClick={() => insert("below")}>
                Insert below
              </Button>
            )}
            <Button size="sm" onClick={() => insert("replace")}>
              {hasSelection ? "Replace" : "Insert"}
            </Button>
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
