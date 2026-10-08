"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Slice } from "@tiptap/pm/model";
import { usePathname, useRouter } from "next/navigation";
import { create } from "zustand";
import { FileText, Plus, Search } from "lucide-react";
import { pageChoices, type DocContent } from "@timely/contract/documents";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { getDoc } from "@/app/utils/api/docs";
import { useCreateDoc, useDocs, useUpdateDoc } from "@/app/utils/hooks/docs";
import { resolveDocContent } from "@/app/utils/markdown";
import { useToastStore } from "@/app/_store/toastStore";
import { deleteBlocks, type BlockRange } from "./blockSelection";

/**
 * "Copy to page" and "Move to page" from the block menu: a searchable list of
 * docs; the blocks go at the end of the chosen one (or into a new page), and
 * a move then removes them here.
 */

type Transfer = { editor: Editor; range: BlockRange; slice: Slice; mode: "copy" | "move" };

const useTransferStore = create<{ transfer: Transfer | null; set: (transfer: Transfer | null) => void }>((set) => ({
  transfer: null,
  set: (transfer) => set({ transfer }),
}));

export function openBlockTransfer(editor: Editor, range: BlockRange, mode: Transfer["mode"]) {
  useTransferStore.getState().set({ editor, range, slice: editor.state.doc.slice(range.from, range.to), mode });
}

/** Blocks as stored JSON, appended to a doc's content. */
function appendBlocks(content: DocContent, blocks: unknown[]): DocContent {
  const existing = (content.content ?? []) as { type?: string; content?: unknown[] }[];
  // A new page's single empty line gives way to the blocks.
  const kept = existing.length === 1 && existing[0].type === "paragraph" && !existing[0].content?.length ? [] : existing;
  return { ...content, type: "doc", content: [...kept, ...blocks] };
}

export default function BlockTransferDialog() {
  const transfer = useTransferStore((state) => state.transfer);
  return transfer ? <TransferDialog transfer={transfer} onClose={() => useTransferStore.getState().set(null)} /> : null;
}

function TransferDialog({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const { data: docs = [] } = useDocs();
  const createDoc = useCreateDoc();
  const updateDoc = useUpdateDoc();
  const router = useRouter();
  const currentId = usePathname().match(/^\/docs\/([^/]+)/)?.[1];
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The panel is hidden while it animates in, and can't take focus until then.
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const focus = () => {
      inputRef.current?.focus();
      if (document.activeElement !== inputRef.current && (tries += 1) < 60) frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, []);

  // Pages nest as in the sidebar; this page stays in the list so its subpages keep their place.
  const matches = useMemo(() => pageChoices(docs, query), [docs, query]);
  // The last row makes a new page.
  const count = matches.length + 1;
  const blockCount = transfer.slice.content.childCount;
  const verb = transfer.mode === "move" ? "Move" : "Copy";

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const finish = async (target: { id?: string; title: string }) => {
    if (busy) return;
    setBusy(true);
    const { editor, range, slice, mode } = transfer;
    const blocks = slice.content.toJSON() as unknown[];
    const text = editor.state.doc.textBetween(range.from, range.to, "\n\n", " ");
    try {
      let id = target.id;
      if (id) {
        const fresh = await getDoc(id);
        const content = appendBlocks(resolveDocContent(fresh.content, fresh.plainText), blocks);
        await updateDoc.mutateAsync({ id, content, plainText: [fresh.plainText, text].filter(Boolean).join("\n\n") });
      } else {
        const created = await createDoc.mutateAsync({ title: target.title, content: { type: "doc", content: blocks }, plainText: text });
        id = created.id;
      }
      // Only the blocks the move started with are removed.
      let removed = false;
      if (mode === "move" && !editor.isDestroyed) {
        const { doc } = editor.state;
        if (range.to <= doc.content.size && doc.slice(range.from, range.to).eq(slice)) {
          deleteBlocks(editor.view, range);
          removed = true;
        }
      }
      const what = blockCount === 1 ? "block" : `${blockCount} blocks`;
      const done = mode === "move" && removed ? "Moved" : "Copied";
      const docId = id;
      useToastStore.getState().show(`${done} ${what} to ${target.title || "Untitled"}`, { label: "Open", onAction: () => router.push(`/docs/${docId}`) });
      onClose();
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : `Could not ${verb.toLowerCase()} the blocks`);
      setBusy(false);
    }
  };

  const choose = (index: number) => {
    if (index < matches.length) {
      const { doc } = matches[index];
      if (doc.id !== currentId) void finish({ id: doc.id, title: doc.title });
    }
    else void finish({ title: query.trim() || "Untitled" });
  };

  return (
    <>
      <OverlayScrim className="z-[130]" onClick={onClose} />
      <OverlayFrame className="z-[130] items-start justify-center p-4 pt-[15vh]">
        <OverlayPanel
          role="dialog"
          aria-label={`${verb} to page`}
          className="flex max-h-[60vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(active);
            }
          }}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              placeholder={`${verb} ${blockCount === 1 ? "block" : `${blockCount} blocks`} to…`}
              aria-label="Search pages"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              disabled={busy}
            />
          </div>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1" role="listbox" aria-label="Pages">
            {matches.map(({ doc, depth, path }, index) => {
              const here = doc.id === currentId;
              return (
                <li key={doc.id} role="option" aria-selected={index === active} aria-disabled={here} data-index={index}>
                  <button
                    type="button"
                    disabled={busy || here}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(index)}
                    style={{ paddingLeft: 8 + depth * 18 }}
                    className={`flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors disabled:opacity-50 ${index === active && !here ? "bg-accent text-accent-foreground" : ""}`}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-sm leading-none">
                      {doc.icon || <FileText className="size-3.5 text-muted-foreground" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {doc.title || "Untitled"}
                      {here && <span className="ml-1.5 text-xs text-muted-foreground">(this page)</span>}
                    </span>
                    {query.trim() && path.length > 0 && (
                      <span className="max-w-[45%] shrink truncate text-xs text-muted-foreground">{path.join(" / ")}</span>
                    )}
                  </button>
                </li>
              );
            })}
            {matches.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">No pages match.</li>}
            <li role="option" aria-selected={active === matches.length} data-index={matches.length}>
              <button
                type="button"
                disabled={busy}
                onMouseEnter={() => setActive(matches.length)}
                onClick={() => choose(matches.length)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${active === matches.length ? "bg-accent text-accent-foreground" : ""}`}
              >
                <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{query.trim() ? `New page “${query.trim()}”` : "New page"}</span>
              </button>
            </li>
          </ul>
        </OverlayPanel>
      </OverlayFrame>
    </>
  );
}
