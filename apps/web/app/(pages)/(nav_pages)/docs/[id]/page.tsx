"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Editor } from "@tiptap/react";
import { ChevronRight, Smile, Star, Trash2 } from "lucide-react";
import RichTextEditor from "@/app/_components/editor/richTextEditor";
import { Doc } from "@/app/_types/types";
import { UpdateDocPayload } from "@/app/utils/api/docs";
import {
  useDeleteDoc,
  useDoc,
  useDocs,
  useUpdateDoc,
} from "@/app/utils/hooks/docs";
import { saveStatusLabel, useAutosave } from "@/app/utils/hooks/useAutosave";

const ICON_CHOICES = [
  "📄", "📝", "📌", "📊", "🗂️", "💡", "🚀", "🎯",
  "🐛", "🧪", "📚", "🔧", "🔥", "✅", "⭐", "🧠",
];

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
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

function DocView({ doc, allDocs }: { doc: Doc; allDocs: Doc[] }) {
  const router = useRouter();
  const updateDoc = useUpdateDoc();
  const deleteDoc = useDeleteDoc();

  const [title, setTitle] = useState(doc.title);
  const [wordCount, setWordCount] = useState(() => countWords(doc.plainText));
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  const { schedule, flush, status } = useAutosave<UpdateDocPayload>((patch) =>
    updateDoc.mutateAsync({ id: doc.id, ...patch }),
  );

  const breadcrumb = useMemo(
    () => buildBreadcrumb(allDocs, doc.id),
    [allDocs, doc.id],
  );

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
  }, []);

  const handleEditorChange = useCallback(
    ({ content, plainText }: { content: Doc["content"]; plainText: string }) => {
      setWordCount(countWords(plainText));
      schedule({ content, plainText });
    },
    [schedule],
  );

  const handleDelete = async () => {
    await deleteDoc.mutateAsync(doc.id);
    router.push("/docs");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-6 py-2.5">
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

        <span className="shrink-0 text-xs text-muted-foreground">
          {saveStatusLabel(status)}
        </span>

        <button
          type="button"
          title={doc.isFavorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => schedule({ isFavorite: !doc.isFavorite })}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Star
            className={`size-4 ${doc.isFavorite ? "fill-warning text-warning" : ""}`}
          />
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
            <div className="absolute right-0 top-9 z-50 w-56 rounded-lg border border-border bg-popover p-3 text-xs shadow-xl">
              <p className="text-muted-foreground">
                Delete this doc and all of its subpages?
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
                  className="cursor-pointer rounded-md bg-destructive px-2 py-1 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-10 pb-32 pt-10">
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
              <div className="absolute left-0 top-12 z-50 w-64 rounded-lg border border-border bg-popover p-2 shadow-xl">
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

          <p className="mb-6 mt-3 text-xs text-muted-foreground">
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </p>

          <RichTextEditor
            content={doc.content}
            onReady={handleEditorReady}
            onChange={handleEditorChange}
          />
        </div>
      </div>
    </div>
  );
}
