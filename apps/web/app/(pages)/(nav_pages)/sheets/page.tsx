"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Sheet as SheetIcon } from "lucide-react";
import { useCreateSheet, useSheets } from "@/app/utils/hooks/sheets";

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

export default function SheetsPage() {
  const router = useRouter();
  const { data: sheets, isLoading } = useSheets();
  const createSheet = useCreateSheet();

  const recentSheets = (sheets ?? []).filter((sheet) => !sheet.archivedAt).slice(0, 12);

  const handleCreate = async () => {
    const sheet = await createSheet.mutateAsync({});
    router.push(`/sheets/${sheet.id}`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground">Sheets</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Track numbers in a grid. Cells support formulas such as{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                =SUM(A1:A10)
              </code>
              ,{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                =B2*1.1
              </code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                =IF(C1&gt;10,&quot;high&quot;,&quot;low&quot;)
              </code>
              .
            </p>
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={createSheet.isPending}
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            <Plus className="size-4" />
            {createSheet.isPending ? "Creating..." : "New sheet"}
          </button>
        </div>

        <h2 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recently edited
        </h2>

        {isLoading && (
          <p className="mt-3 text-sm text-muted-foreground">Loading sheets...</p>
        )}

        {!isLoading && recentSheets.length === 0 && (
          <div className="mt-3 flex flex-1 items-center justify-center rounded-xl border border-dashed border-border px-6 py-10">
            <p className="text-sm text-muted-foreground">
              Nothing here yet. Create a sheet to get started.
            </p>
          </div>
        )}

        {recentSheets.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recentSheets.map((sheet) => (
              <Link
                key={sheet.id}
                href={`/sheets/${sheet.id}`}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-ring hover:bg-accent/40"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">
                    {sheet.icon ?? (
                      <SheetIcon className="size-4 text-muted-foreground" />
                    )}
                  </span>
                  <span className="truncate font-medium text-foreground">
                    {sheet.title}
                  </span>
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  {sheet.rows.length} rows &middot; {sheet.columns.length}{" "}
                  columns
                </p>

                <p className="mt-3 text-xs text-muted-foreground">
                  {formatUpdatedAt(sheet.updatedAt)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
