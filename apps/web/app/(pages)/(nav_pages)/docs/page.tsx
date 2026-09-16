"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Upload } from "lucide-react";
import { useCreateDoc, useDocs } from "@/app/utils/hooks/docs";
import { readMarkdownFile } from "@/app/utils/importMarkdown";

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DocsPage() {
  const router = useRouter();
  const { data: docs, isLoading } = useDocs();
  const createDoc = useCreateDoc();

  const recentDocs = (docs ?? []).filter((doc) => !doc.archivedAt).slice(0, 12);

  const handleCreate = async () => {
    const doc = await createDoc.mutateAsync({});
    router.push(`/docs/${doc.id}`);
  };

  const handleImport = async (file: File) => {
    const imported = await readMarkdownFile(file);
    const doc = await createDoc.mutateAsync({
      title: imported.title,
      content: imported.content,
      plainText: imported.plainText,
    });
    router.push(`/docs/${doc.id}`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-foreground">Docs</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Write notes, specs and meeting minutes. Type{" "}
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs">
                /
              </kbd>{" "}
              inside a page for blocks, or use markdown shortcuts like{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">##</code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">-</code>.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-[#191b22] px-4 py-2 font-medium text-foreground transition-colors hover:border-[#c0c1ff]/30">
              <Upload className="size-4" />
              Import .md
              <input
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handleImport(file);
                }}
              />
            </label>
            <button
              type="button"
              onClick={handleCreate}
              disabled={createDoc.isPending}
              className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#c0c1ff] px-4 py-2 font-medium text-[#1000a9] hover:bg-[#a8a6ff] disabled:opacity-60"
            >
              <Plus className="size-4" />
              {createDoc.isPending ? "Creating..." : "New doc"}
            </button>
          </div>
        </div>

        <h2 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recently edited
        </h2>

        {isLoading && (
          <p className="mt-3 text-sm text-muted-foreground">Loading docs...</p>
        )}

        {!isLoading && recentDocs.length === 0 && (
          <div className="mt-3 flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#191b22] px-6 py-10">
            <p className="text-sm text-muted-foreground">
              Nothing here yet. Your pages will show up once you create one.
            </p>
          </div>
        )}

        {recentDocs.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recentDocs.map((doc) => (
              <Link
                key={doc.id}
                href={`/docs/${doc.id}`}
                className="group rounded-xl border border-white/10 bg-[#191b22] p-4 transition-colors hover:border-[#c0c1ff]/30 hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">
                    {doc.icon ?? (
                      <FileText className="size-4 text-muted-foreground" />
                    )}
                  </span>
                  <span className="truncate font-medium text-foreground">
                    {doc.title}
                  </span>
                </div>

                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                  {doc.plainText.trim() || "Empty page"}
                </p>

                <p className="mt-3 text-xs text-muted-foreground">
                  {formatUpdatedAt(doc.updatedAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
