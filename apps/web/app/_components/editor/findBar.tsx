"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { getFindState, type FindState } from "./findReplace";

const iconButton =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40";
const input =
  "h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring";

/** The find and replace bar over a doc (Ctrl/Cmd+F). */
export default function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [find, setFind] = useState<FindState>(() => getFindState(editor.state));
  const [replacement, setReplacement] = useState("");
  const queryRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // Start from the selected text, as editors do.
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? "" : editor.state.doc.textBetween(from, to, " ");
    if (selected && !selected.includes("\n") && selected.length <= 200) editor.commands.setFind({ query: selected });
    queryRef.current?.focus();
    queryRef.current?.select();
    const sync = () => setFind(getFindState(editor.state));
    sync();
    editor.on("transaction", sync);
    // A button that just got disabled drops focus to the page; Esc still closes.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (document.activeElement === document.body || document.activeElement === null)) onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      editor.off("transaction", sync);
      if (!editor.isDestroyed) editor.commands.setFind({ query: "" });
    };
  }, [editor]);

  const count = find.matches.length;
  const close = () => {
    onClose();
    editor.commands.focus();
  };

  return (
    <div
      role="search"
      aria-label="Find and replace"
      className="absolute right-3 top-2 z-30 flex w-[22rem] max-w-[calc(100%-1.5rem)] flex-col gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-xl"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="flex items-center gap-1">
        <input
          ref={queryRef}
          value={find.query}
          onChange={(event) => editor.commands.setFind({ query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              editor.commands.findStep(event.shiftKey ? -1 : 1);
            }
          }}
          placeholder="Find"
          aria-label="Find"
          className={input}
        />
        <span className="w-14 shrink-0 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {find.query ? (count ? `${find.current + 1} of ${count}` : "No results") : ""}
        </span>
        <button
          type="button"
          title="Match case"
          aria-pressed={find.caseSensitive}
          onClick={() => editor.commands.setFind({ caseSensitive: !find.caseSensitive })}
          className={`${iconButton} text-xs font-semibold ${find.caseSensitive ? "bg-accent text-accent-foreground" : ""}`}
        >
          Aa
        </button>
        <button type="button" title="Previous (Shift+Enter)" aria-label="Previous match" disabled={!count} onClick={() => editor.commands.findStep(-1)} className={iconButton}>
          <ChevronUp className="size-4" />
        </button>
        <button type="button" title="Next (Enter)" aria-label="Next match" disabled={!count} onClick={() => editor.commands.findStep(1)} className={iconButton}>
          <ChevronDown className="size-4" />
        </button>
        <button type="button" title="Close (Esc)" aria-label="Close find" onClick={close} className={iconButton}>
          <X className="size-4" />
        </button>
      </div>
      {editor.isEditable && (
        <div className="flex items-center gap-1">
          <input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                editor.commands.replaceCurrent(replacement);
              }
            }}
            placeholder="Replace with"
            aria-label="Replace with"
            className={input}
          />
          <button
            type="button"
            disabled={!count}
            onClick={() => editor.commands.replaceCurrent(replacement)}
            className="h-7 shrink-0 rounded-md border border-border px-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
          >
            Replace
          </button>
          <button
            type="button"
            disabled={!count}
            onClick={() => editor.commands.replaceAll(replacement)}
            className="h-7 shrink-0 rounded-md border border-border px-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
          >
            All
          </button>
        </div>
      )}
    </div>
  );
}
