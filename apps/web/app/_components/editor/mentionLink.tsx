"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { AtSign, Loader2, Sparkles } from "lucide-react";
import { matchMention, sendDecisionFeedback, type MentionMatch, type MentionTarget } from "@/app/utils/api/decisions";
import { useDecisions } from "@/app/utils/hooks/decisions";
import { useToastStore } from "@/app/_store/toastStore";
import { MENTION_TYPE_LABELS } from "./mention";

/** Toolbar button that turns the selected phrase into a mention [49]: smart
 * suggestions pick the item the phrase most likely means, with the closest
 * other items under it. Hidden while suggestions are off. */
export default function MentionLinkButton({ editor, docId }: { editor: Editor; docId?: string }) {
  const { data: settings } = useDecisions();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MentionMatch | null>(null);
  const [range, setRange] = useState<{ from: number; to: number; text: string } | null>(null);
  if (!settings?.available) return null;

  const run = async () => {
    const { from, to, $from, $to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, " ").trim();
    if (!text || !$from.sameParent($to)) {
      useToastStore.getState().show("Select a phrase within one line to link it to an item");
      return;
    }
    setRange({ from, to, text: editor.state.doc.textBetween(from, to, " ") });
    setResult(null);
    setOpen(true);
    setLoading(true);
    try {
      setResult(await matchMention(text, docId));
    } catch {
      setResult({ available: true, options: [] });
    } finally {
      setLoading(false);
    }
  };

  const pick = (target: MentionTarget) => {
    if (!range) return;
    const size = editor.state.doc.content.size;
    // The doc may have changed while the match loaded (typing, a remote save).
    if (range.to > size || editor.state.doc.textBetween(range.from, range.to, " ") !== range.text) {
      useToastStore.getState().show("The text changed. Select the phrase again.");
      setOpen(false);
      return;
    }
    // A space after the mention when a word or the end of the text follows,
    // none before a space or punctuation.
    const next = range.to < size ? editor.state.doc.textBetween(range.to, Math.min(range.to + 1, size), " ") : "";
    editor
      .chain()
      .focus()
      .insertContentAt({ from: range.from, to: range.to }, [
        { type: "mention", attrs: { id: target.id, label: target.title, entityType: target.kind, appearance: "mention" } },
        ...(next === "" || /^[\p{L}\p{N}]/u.test(next) ? [{ type: "text", text: " " }] : []),
      ])
      .run();
    if (result?.logId) void sendDecisionFeedback(result.logId, result.match?.id === target.id).catch(() => {});
    setOpen(false);
  };

  const others = (result?.options ?? []).filter((o) => o.id !== result?.match?.id);
  const row = (target: MentionTarget, best = false) => (
    <button
      key={`${target.kind}:${target.id}`}
      type="button"
      role="menuitem"
      onClick={() => pick(target)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
    >
      {best ? <Sparkles className="size-3.5 shrink-0 text-primary" /> : <AtSign className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate">{target.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{MENTION_TYPE_LABELS[target.kind]}</span>
    </button>
  );

  return (
    <div className="relative">
      <button
        type="button"
        title="Link selection to an item"
        aria-label="Link selection to an item"
        aria-expanded={open}
        onClick={() => void run()}
        className={`flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground ${open ? "bg-accent text-accent-foreground" : ""}`}
      >
        <AtSign className="size-3.5" />
        <Sparkles className="-ml-1 -mt-2 size-2.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div role="menu" aria-label="Link to" data-testid="mention-link" className="absolute left-0 top-9 z-50 w-72 rounded-lg border border-border bg-popover p-1 shadow-xl">
            {loading ? (
              <p className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Finding a match…
              </p>
            ) : result?.match || others.length ? (
              <>
                {result?.match && (
                  <>
                    <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">Best match</p>
                    {row(result.match, true)}
                  </>
                )}
                {others.length > 0 && (
                  <>
                    <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">{result?.match ? "Or" : "Closest items"}</p>
                    {others.map((o) => row(o))}
                  </>
                )}
              </>
            ) : (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">Nothing in your work matches that phrase.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
