"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Editor, Range } from "@tiptap/react";
import { ChevronRight, Archive, Download, History, LayoutTemplate, Smile, Star, Trash2, Upload } from "lucide-react";
import RichTextEditor from "@/app/_components/editor/richTextEditor";
import HeadingMinimap from "@/app/_components/docs/headingMinimap";
import Backlinks from "@/app/_components/docs/backlinks";
import DocHistory from "@/app/_components/docs/docHistory";
import { insertPageMention } from "@/app/_components/editor/mention";
import ExpandCollapsedListButton from "@/app/_components/_ui/expandCollapsedListButton";
import { Doc } from "@/app/_types/types";
import { UpdateDocPayload } from "@/app/utils/api/docs";
import { useQueryClient } from "@tanstack/react-query";
import {
  docKey,
  useCreateDoc,
  useDeleteDoc,
  useDoc,
  useDocWatch,
  useDocs,
  useUpdateDoc,
} from "@/app/utils/hooks/docs";
import { useAutosave } from "@/app/utils/hooks/useAutosave";
import { resolveDocContent } from "@/app/utils/markdown";
import SaveStatusBadge from "@/app/_components/_ui/saveStatus";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { downloadPortable } from "@/app/utils/api/portability";
import { readMarkdownFile } from "@/app/utils/importMarkdown";

const ICON_CHOICES = [
  "📄", "📝", "📌", "📊", "🗂️", "💡", "🚀", "🎯",
  "🐛", "🧪", "📚", "🔧", "🔥", "✅", "⭐", "🧠",
];

// Runs on every keystroke, so it counts in place instead of splitting the
// text: a doc holding a large 3D model or map has hundreds of thousands of
// "words", and building that array each time stalled typing.
function countWords(text: string) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const space = code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 0x2028 || code === 0x2029 || code === 0xfeff || (code >= 0x2000 && code <= 0x200a) || code === 0x1680 || code === 0x202f || code === 0x205f || code === 0x3000;
    if (space) inWord = false;
    else if (!inWord) {
      inWord = true;
      count += 1;
    }
  }
  return count;
}

function buildBreadcrumb(docs: Doc[], docId: string) {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const trail: Doc[] = [];

  let current = byId.get(docId)?.parentId ?? null;
  while (current && trail.length < 20) {
    const parent = byId.get(current);
    if (!parent) break;
    trail.unshift(parent);
    current = parent.parentId;
  }

  return trail;
}

export default function DocPage() {
  const params = useParams<{ id: string }>();
  const { data: doc, isLoading, isError, error } = useDoc(params.id);
  const { data: allDocs } = useDocs();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading doc...
      </div>
    );
  }

  if (isError || !doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "This doc could not be found."}
        </p>
        <Link
          href="/docs"
          className="rounded-lg bg-secondary px-4 py-2 text-sm text-secondary-foreground transition-colors hover:bg-accent"
        >
          Back to docs
        </Link>
      </div>
    );
  }

  // Keying by id remounts the editor and its local draft state whenever a
  // different page is opened.
  return <DocView key={doc.id} doc={doc} allDocs={allDocs ?? []} />;
}

function countDescendantsFromList(docs: Doc[], id: string): number {
  const children = docs.filter((doc) => doc.parentId === id);
  return children.reduce(
    (total, child) => total + 1 + countDescendantsFromList(docs, child.id),
    0,
  );
}

function DocView({ doc, allDocs }: { doc: Doc; allDocs: Doc[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const createDoc = useCreateDoc();
  const updateDoc = useUpdateDoc();
  const deleteDoc = useDeleteDoc();

  const [title, setTitle] = useState(doc.title);
  const [wordCount, setWordCount] = useState(() => countWords(doc.plainText));
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [remoteEpoch, setRemoteEpoch] = useState(0);
  const [remoteContent, setRemoteContent] = useState<Doc["content"] | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const lastSavedAtRef = useRef<string | null>(doc.updatedAt);
  // The editor is seeded once per document; later remote updates arrive via
  // `remoteContent`, so this deliberately does not track content changes.
  const [seedContent] = useState(() => resolveDocContent(doc.content, doc.plainText));

  const { schedule, flush, status, hasUnsavedChanges } = useAutosave<UpdateDocPayload>(
    async (patch) => {
      const saved = await updateDoc.mutateAsync({ id: doc.id, ...patch });
      lastSavedAtRef.current = saved.updatedAt;
      return saved;
    },
  );

  useDocWatch(doc.id, {
    lastSavedAtRef,
    hasLocalEdits: hasUnsavedChanges,
    isEditorFocused: () => Boolean(editorRef.current?.isFocused),
    // Apply the remote copy straight from the event so local title, word
    // count and editor content move together in one handler, no effect hop.
    onRemote: (remote) => {
      const next = remote ?? queryClient.getQueryData<Doc>(docKey(doc.id)) ?? doc;
      setTitle(next.title);
      setWordCount(countWords(next.plainText));
      setRemoteContent(resolveDocContent(next.content, next.plainText));
      setRemoteEpoch((epoch) => epoch + 1);
    },
    onDeleted: () => router.push("/docs"),
  });

  const descendantCount = countDescendantsFromList(allDocs, doc.id);
  const breadcrumb = useMemo(
    () => buildBreadcrumb(allDocs, doc.id),
    [allDocs, doc.id],
  );

  const handleEditorReady = useCallback((readyEditor: Editor) => {
    editorRef.current = readyEditor;
    setEditor(readyEditor);
  }, []);

  // The word count waits for a pause in typing, so long docs stay responsive.
  const wordTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(wordTimerRef.current), []);

  const handleEditorChange = useCallback(
    ({ content, plainText }: { content: Doc["content"]; plainText: string }) => {
      window.clearTimeout(wordTimerRef.current);
      wordTimerRef.current = window.setTimeout(() => setWordCount(countWords(plainText)), 300);
      schedule({ content, plainText });
    },
    [schedule],
  );

  const handleCreateSubpage = useCallback(
    async ({ editor, range }: { editor: Editor; range: Range }) => {
      try {
        const child = await createDoc.mutateAsync({ parentId: doc.id });
        if (editor.isDestroyed) return;
        insertPageMention(editor, range, child);
        const saved = await flush();
        if (!saved) {
          useToastStore.getState().show("Subpage created, but the parent could not be saved");
        }
        router.push(`/docs/${child.id}`);
      } catch {
        useToastStore.getState().show("Could not create subpage");
      }
    },
    [createDoc, doc.id, flush, router],
  );

  const handleDelete = async () => {
    await deleteDoc.mutateAsync(doc.id);
    router.push("/docs");
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-6 py-2.5">
        <ExpandCollapsedListButton
          storageKey="timely.docsListCollapsed"
          label="docs list"
        />
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground">
          <Link
            href="/docs"
            className="shrink-0 transition-colors hover:text-foreground"
          >
            Docs
          </Link>
          {breadcrumb.map((parent) => (
            <span key={parent.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-3 shrink-0" />
              <Link
                href={`/docs/${parent.id}`}
                className="truncate transition-colors hover:text-foreground"
              >
                {parent.title}
              </Link>
            </span>
          ))}
          <ChevronRight className="size-3 shrink-0" />
          <span className="truncate text-foreground">{doc.title}</span>
        </nav>

        <SaveStatusBadge status={status} onRetry={() => void flush()} />

        <button
          type="button"
          title="Import Markdown"
          aria-label="Import a Markdown file"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".md,.markdown,text/markdown,text/plain";
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;
              const imported = await readMarkdownFile(file);
              editorRef.current?.commands.setContent(imported.content as Parameters<Editor["commands"]["setContent"]>[0]);
              setWordCount(countWords(imported.plainText));
              schedule({ content: imported.content, plainText: imported.plainText });
              void flush();
            };
            input.click();
          }}
          className="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent"
        >
          <Upload className="size-4" />
        </button>
        <button
          type="button"
          title="Download as Markdown"
          aria-label="Download document as Markdown"
          onClick={async () => {
            // The file comes from the server, so save the latest typing first.
            await flush();
            void downloadPortable(`/docs/${doc.id}/export?format=markdown`, `${doc.title}.md`);
          }}
          className="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent"
        >
          <Download className="size-4" />
        </button>

        <button
          type="button"
          title={doc.isTemplate ? "Stop using as a template" : "Use as a template"}
          aria-pressed={Boolean(doc.isTemplate)}
          onClick={() => {
            const next = !doc.isTemplate;
            schedule({ isTemplate: next });
            useToastStore
              .getState()
              .show(next ? "Now offered under Template in the docs list" : "No longer a template");
          }}
          className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent ${
            doc.isTemplate ? "text-primary" : ""
          }`}
        >
          <LayoutTemplate className="size-4" />
        </button>

        <button
          type="button"
          title="Version history"
          aria-label="Version history"
          onClick={() => setIsHistoryOpen(true)}
          className="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent"
        >
          <History className="size-4" />
        </button>

        <button
          type="button"
          title={doc.isFavorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => schedule({ isFavorite: !doc.isFavorite })}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground"
        >
          <Star
            className={`size-4 ${doc.isFavorite ? "fill-warning text-warning" : ""}`}
          />
        </button>

        <button
          type="button"
          title={doc.archivedAt ? "Unarchive" : "Archive"}
          onClick={() => {
            const next = !doc.archivedAt;
            schedule({ archived: next });
            showUndoToast(next ? "Archived" : "Unarchived", () =>
              schedule({ archived: !next }),
            );
          }}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent"
        >
          <Archive className={`size-4 ${doc.archivedAt ? "text-warning" : ""}`} />
        </button>

        <div className="relative shrink-0">
          <button
            type="button"
            title="Delete doc"
            onClick={() => setIsConfirmingDelete((previous) => !previous)}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>

          {isConfirmingDelete && (
            <div className="absolute right-0 top-9 z-50 w-56 rounded-lg border border-border bg-card p-3 text-xs shadow-xl">
              <p className="text-muted-foreground">
                Delete <span className="text-foreground">{doc.title || "this doc"}</span>
                {descendantCount > 0
                  ? ` and its ${descendantCount} subpage${descendantCount === 1 ? "" : "s"}`
                  : ""}
                ?
              </p>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  className="cursor-pointer rounded-md bg-secondary px-2 py-1 text-secondary-foreground transition-colors hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteDoc.isPending}
                  className="cursor-pointer rounded-md bg-destructive-container px-2 py-1 text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-10 pt-10">
        <div className="shrink-0">
          <div className="relative mb-1">
            <button
              type="button"
              onClick={() => setIsIconPickerOpen((previous) => !previous)}
              title="Change icon"
              className="flex size-11 cursor-pointer items-center justify-center rounded-lg text-3xl transition-colors hover:bg-accent"
            >
              {doc.icon ?? <Smile className="size-6 text-muted-foreground" />}
            </button>

            {isIconPickerOpen && (
              <div className="absolute left-0 top-12 z-50 w-64 rounded-lg border border-border bg-card p-2 shadow-xl">
                <div className="grid grid-cols-8 gap-1">
                  {ICON_CHOICES.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => {
                        schedule({ icon });
                        setIsIconPickerOpen(false);
                      }}
                      className="flex size-7 cursor-pointer items-center justify-center rounded transition-colors hover:bg-accent"
                    >
                      {icon}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    schedule({ icon: "" });
                    setIsIconPickerOpen(false);
                  }}
                  className="mt-2 w-full cursor-pointer rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent"
                >
                  Remove icon
                </button>
              </div>
            )}
          </div>

          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              schedule({ title: event.target.value });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "ArrowDown") {
                event.preventDefault();
                editorRef.current?.commands.focus("start");
              }
            }}
            onBlur={() => void flush()}
            placeholder="Untitled"
            className="w-full bg-transparent text-4xl font-bold text-foreground outline-none placeholder:text-muted-foreground/50"
          />

          <div className="mb-4 mt-3 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span>
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
            {doc.isTemplate && (
              <span className="rounded-full bg-primary/12 px-2 py-0.5 font-medium text-primary">Template</span>
            )}
            <Backlinks docId={doc.id} />
          </div>
        </div>

        <div className="min-h-0 flex-1 pb-8">
          <RichTextEditor
            toolbar="fixed"
            content={remoteContent ?? seedContent}
            syncKey={remoteEpoch}
            onReady={handleEditorReady}
            onChange={handleEditorChange}
            onCreateSubpage={handleCreateSubpage}
          />
        </div>
      </div>

      <HeadingMinimap editor={editor} />

      {isHistoryOpen && (
        <DocHistory
          docId={doc.id}
          onClose={() => setIsHistoryOpen(false)}
          beforeRestore={flush}
          onRestored={(restored) => {
            lastSavedAtRef.current = restored.updatedAt;
            queryClient.setQueryData(docKey(doc.id), restored);
            setTitle(restored.title);
            setWordCount(countWords(restored.plainText));
            setRemoteContent(resolveDocContent(restored.content, restored.plainText));
            setRemoteEpoch((epoch) => epoch + 1);
          }}
        />
      )}
    </div>
  );
}
