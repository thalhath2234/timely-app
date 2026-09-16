"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Sheet as SheetIcon, Star, Upload } from "lucide-react";
import { useCreateSheet, useSheets } from "@/app/utils/hooks/sheets";
import { QueryFailure } from "@/app/_components/_ui/loadError";
import { csvToGrid } from "@/app/utils/sheetCsv";
import { formatSheetDate, sheetMetaLabel } from "@/app/utils/sheetWorkbook";

export default function SheetsPage() {
  const router = useRouter();
  const sheetsQuery = useSheets();
  const { data: sheets, isLoading } = sheetsQuery;
  const createSheet = useCreateSheet();

  const activeSheets = (sheets ?? []).filter((sheet) => !sheet.archivedAt);
  const favorites = activeSheets.filter((sheet) => sheet.isFavorite);
  const recentSheets = activeSheets.slice(0, 12);

  const handleCreate = async () => {
    const sheet = await createSheet.mutateAsync({});
    router.push(`/sheets/${sheet.id}`);
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    const grid = csvToGrid(text);
    const title = file.name.replace(/\.csv$/i, "") || "Imported sheet";
    const sheet = await createSheet.mutateAsync({ title, ...grid });
    router.push(`/sheets/${sheet.id}`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-foreground">Sheets</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Track numbers in a grid. Cells support formulas such as{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-primary">
                =SUM(A1:A10)
              </code>
              ,{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-success">
                =B2*1.1
              </code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-warning">
                =IF(C1&gt;10,&quot;high&quot;,&quot;low&quot;)
              </code>
              .
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-[#191b22] px-4 py-2 font-medium text-foreground transition-colors hover:border-[#c0c1ff]/30">
              <Upload className="size-4" />
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
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
              disabled={createSheet.isPending}
              className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#c0c1ff] px-4 py-2 font-medium text-[#1000a9] hover:bg-[#a8a6ff] disabled:opacity-60"
            >
              <Plus className="size-4" />
              {createSheet.isPending ? "Creating..." : "New sheet"}
            </button>
          </div>
        </div>

        {favorites.length > 0 && (
          <>
            <h2 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Favorites
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {favorites.map((sheet) => (
                <SheetCard
                  key={sheet.id}
                  href={`/sheets/${sheet.id}`}
                  title={sheet.title}
                  icon={sheet.icon}
                  meta={sheetMetaLabel(sheet)}
                  favorite
                />
              ))}
            </div>
          </>
        )}

        <h2 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recently edited
        </h2>

        {isLoading && (
          <p className="mt-3 text-sm text-muted-foreground">Loading sheets...</p>
        )}

        {sheetsQuery.isError && (
          <QueryFailure
            what="sheets"
            hasData={Boolean(sheets)}
            error={sheetsQuery.error}
            onRetry={() => sheetsQuery.refetch()}
            retrying={sheetsQuery.isFetching}
            className="mt-3"
          />
        )}

        {!isLoading && !(sheetsQuery.isError && !sheets) && recentSheets.length === 0 && (
          <div className="mt-3 flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#191b22] px-6 py-10">
            <p className="text-sm text-muted-foreground">
              Nothing here yet. Create a sheet or import a CSV to get started.
            </p>
          </div>
        )}

        {recentSheets.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recentSheets.map((sheet) => (
              <SheetCard
                key={sheet.id}
                href={`/sheets/${sheet.id}`}
                title={sheet.title}
                icon={sheet.icon}
                meta={`${sheet.rows.length} rows · ${sheet.columns.length} columns`}
                updated={formatSheetDate(sheet.updatedAt)}
                favorite={sheet.isFavorite}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SheetCard({
  href,
  title,
  icon,
  meta,
  updated,
  favorite,
}: {
  href: string;
  title: string;
  icon: string | null;
  meta: string;
  updated?: string;
  favorite?: boolean;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-white/10 bg-[#191b22] p-4 transition-colors hover:border-[#c0c1ff]/30 hover:bg-white/[0.03]"
    >
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-[#c0c1ff]/12 text-base leading-none text-[#c0c1ff]">
          {icon ?? <SheetIcon className="size-4" />}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {title}
        </span>
        {favorite && <Star className="size-3.5 shrink-0 fill-warning text-warning" />}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{meta}</p>
      {updated ? (
        <p className="mt-3 text-xs text-muted-foreground">{updated}</p>
      ) : null}
    </Link>
  );
}
