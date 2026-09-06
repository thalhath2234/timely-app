"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, MoreHorizontal, Smile, Star, Trash2 } from "lucide-react";
import type { Editor } from "@tiptap/react";
import MobileHeader, { HeaderIconButton } from "@/app/_components/mobile/MobileHeader";
import BottomSheet, { SheetOption } from "@/app/_components/mobile/BottomSheet";
import EmptyState from "@/app/_components/mobile/EmptyState";
import RichTextEditor from "@/app/_components/editor/richTextEditor";
import { useMobileDoc, useMobileWorkspaces } from "@/app/_lib/mobile/useMobileData";
import { useDeleteDoc, useDocWatch, useUpdateDoc } from "@/app/utils/hooks/docs";
import { saveStatusLabel, useAutosave } from "@/app/utils/hooks/useAutosave";
import { isRichContentEmpty, toRichContent } from "@/app/utils/richText";
import type { UpdateDocPayload } from "@/app/utils/api/docs";
import type { Doc } from "@/app/_types/types";
import { timeAgo } from "@/app/_lib/mobile/format";

const ICON_CHOICES = [
  "📄", "📝", "📌", "📊", "🗂️", "💡", "🚀", "🎯",
  "🐛", "🧪", "📚", "🔧", "🔥", "✅", "⭐", "🧠",
];

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export default function MobileDocDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: doc, isDemo, isLoading } = useMobileDoc(id);

  if (!doc) {
    return (
      <>
        <MobileHeader title="Doc" backHref="/m/docs" large={false} />
        <main className="flex-1">
          {isLoading ? null : <EmptyState icon={FileText} title="Doc not found" />}
        </main>
      </>
    );
  }

  // Keyed by id so the editor's draft state resets when another doc opens.
  return <DocEditor key={doc.id} doc={doc} isDemo={isDemo} />;
}

function DocEditor({ doc, isDemo }: { doc: Doc; isDemo: boolean }) {
  const router = useRouter();
  const { data: workspaces } = useMobileWorkspaces();
  const updateDoc = useUpdateDoc();
  const deleteDoc = useDeleteDoc();

  const [title, setTitle] = useState(doc.title);
  const [icon, setIcon] = useState(doc.icon ?? "");
  const [favorite, setFavorite] = useState(doc.isFavorite);
  const [wordCount, setWordCount] = useState(() => countWords(doc.plainText));
  const [menu, setMenu] = useState<"more" | "icon" | "delete" | null>(null);
  const [remoteEpoch, setRemoteEpoch] = useState(0);
  const [editorRef, setEditorRef] = useState<Editor | null>(null);
  const lastSavedAtRef = useRef<string | null>(doc.updatedAt);

  // In sample mode the API is unreachable, so edits stay in component state.
  const { schedule, flush, status, hasUnsavedChanges } = useAutosave<UpdateDocPayload>(
    async (patch) => {
      if (isDemo) return;
      const saved = await updateDoc.mutateAsync({ id: doc.id, ...patch });
      lastSavedAtRef.current = saved.updatedAt;
      return saved;
    },
  );

  useDocWatch(doc.id, {
    enabled: !isDemo,
    lastSavedAtRef,
    hasLocalEdits: hasUnsavedChanges,
    onRemote: () => setRemoteEpoch((epoch) => epoch + 1),
    onDeleted: () => router.push("/m/docs"),
  });

  useEffect(() => {
    if (remoteEpoch === 0) return;
    setTitle(doc.title);
    setIcon(doc.icon ?? "");
    setFavorite(doc.isFavorite);
    setWordCount(countWords(doc.plainText));
  }, [remoteEpoch, doc.title, doc.icon, doc.isFavorite, doc.plainText]);

  const handleEditorChange = useCallback(
    ({ content, plainText }: { content: Doc["content"]; plainText: string }) => {
      setWordCount(countWords(plainText));
      schedule({ content, plainText });
    },
    [schedule],
  );

  const workspace = workspaces.find((w) => w.id === doc.workspaceId);

  async function remove() {
    if (!isDemo) await deleteDoc.mutateAsync(doc.id);
    router.push("/m/docs");
  }

  return (
    <>
      <MobileHeader
        title={workspace?.name ?? "Doc"}
        subtitle={saveStatusLabel(status) || `Edited ${timeAgo(doc.updatedAt)}`}
        backHref="/m/docs"
        large={false}
        isDemo={isDemo}
        actions={
          <>
            <HeaderIconButton
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              active={favorite}
              onClick={() => {
                setFavorite(!favorite);
                schedule({ isFavorite: !favorite });
              }}
            >
              <Star size={20} className={favorite ? "fill-warning text-warning" : ""} />
            </HeaderIconButton>
            <HeaderIconButton label="More" onClick={() => setMenu("more")}>
              <MoreHorizontal size={22} />
            </HeaderIconButton>
          </>
        }
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 px-5 pt-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              aria-label="Change icon"
              onClick={() => setMenu("icon")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card text-[28px] leading-none active:bg-muted"
            >
              {icon || <Smile size={22} className="text-muted-foreground" />}
            </button>
            <textarea
              value={title}
              rows={1}
              placeholder="Untitled"
              aria-label="Title"
              onChange={(e) => {
                setTitle(e.target.value);
                schedule({ title: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  editorRef?.commands.focus("start");
                }
              }}
              onBlur={() => void flush()}
              className="min-w-0 flex-1 resize-none bg-transparent pt-1 text-[24px] font-semibold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50 field-sizing-content"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </p>
        </div>

        <div className="mobile-editor mt-3 flex min-h-0 flex-1 flex-col px-5 pb-6">
          <RichTextEditor
            key={`${doc.id}:${remoteEpoch}`}
            content={
              isRichContentEmpty(doc.content)
                ? toRichContent(null, doc.plainText)
                : doc.content
            }
            onReady={setEditorRef}
            onChange={handleEditorChange}
            toolbar="fixed"
            placeholder="Start writing. Type '/' for blocks, '@' to mention…"
          />
        </div>
      </main>

      <BottomSheet open={menu === "more"} onClose={() => setMenu(null)} title="Doc">
        <SheetOption onSelect={() => setMenu("icon")} leading={<Smile size={18} />}>
          Change icon
        </SheetOption>
        <SheetOption
          onSelect={() => setMenu("delete")}
          leading={<Trash2 size={18} className="text-destructive" />}
        >
          <span className="text-destructive">Delete doc</span>
        </SheetOption>
      </BottomSheet>

      <BottomSheet open={menu === "icon"} onClose={() => setMenu(null)} title="Icon">
        <div className="grid grid-cols-8 gap-1">
          {ICON_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => {
                setIcon(choice);
                schedule({ icon: choice });
                setMenu(null);
              }}
              className={`flex h-11 items-center justify-center rounded-xl text-[24px] active:bg-muted ${
                choice === icon ? "bg-accent" : ""
              }`}
            >
              {choice}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setIcon("");
            schedule({ icon: "" });
            setMenu(null);
          }}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-xl bg-secondary text-[14px] font-medium text-secondary-foreground"
        >
          Remove icon
        </button>
      </BottomSheet>

      <BottomSheet open={menu === "delete"} onClose={() => setMenu(null)} title="Delete this doc?">
        <p className="px-1 pb-4 text-[14px] text-muted-foreground">
          The doc and all of its subpages will be removed.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMenu(null)}
            className="flex h-12 flex-1 items-center justify-center rounded-xl border border-border bg-card text-[15px] font-medium text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={deleteDoc.isPending}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-destructive text-[15px] font-semibold text-white disabled:opacity-60"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
