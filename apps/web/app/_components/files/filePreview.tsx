"use client";

import Link from "next/link";
import { ArrowUpRight, FileText, Sheet as SheetIcon, Star } from "lucide-react";
import { buttonClass } from "@/app/_components/_ui/button";
import { RailSection } from "@/app/_components/_ui/pageWithRail";
import { formatUpdatedAt } from "@/app/_components/docs/docCard";
import { fileHref } from "@/app/utils/fileRoutes";
import { plural } from "@/app/utils/plural";
import type { Doc, Sheet } from "@/app/_types/types";

export type FileItem = { kind: "doc"; doc: Doc } | { kind: "sheet"; sheet: Sheet };

/** Words in a doc, from its plain text. */
export function docWords(doc: Pick<Doc, "plainText">) {
  const text = doc.plainText.trim();
  return text ? text.split(/\s+/).length : 0;
}

const PREVIEW_ROWS = 5;
const PREVIEW_COLS = 4;

/**
 * The Files page rail's first card: a look at the selected file without
 * opening it. A doc shows its first lines, a sheet its first rows.
 */
export default function FilePreview({ item }: { item: FileItem | null }) {
  if (!item) {
    return (
      <RailSection title="Preview" icon={<FileText className="size-3.5 text-muted-foreground" />} data-testid="file-preview">
        <p className="text-xs text-muted-foreground">Select a file to see it here. Double-click or press Enter to open it.</p>
      </RailSection>
    );
  }
  const id = item.kind === "doc" ? item.doc.id : item.sheet.id;
  const title = item.kind === "doc" ? item.doc.title : item.sheet.title;
  const icon = item.kind === "doc" ? item.doc.icon : item.sheet.icon;
  const favorite = item.kind === "doc" ? item.doc.isFavorite : item.sheet.isFavorite;
  const updatedAt = item.kind === "doc" ? item.doc.updatedAt : item.sheet.updatedAt;
  const meta =
    item.kind === "doc"
      ? `Doc · ${plural(docWords(item.doc), "word")}`
      : `Sheet · ${plural(item.sheet.rows.length, "row")} · ${plural(item.sheet.columns.length, "column")}`;

  return (
    <RailSection
      title="Preview"
      icon={item.kind === "doc" ? <FileText className="size-3.5 text-muted-foreground" /> : <SheetIcon className="size-3.5 text-primary" />}
      action={
        <Link href={fileHref(id)} className={buttonClass({ variant: "soft", size: "sm" })}>
          Open
          <ArrowUpRight />
        </Link>
      }
      data-testid="file-preview"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-lg leading-none">
          {icon ?? (item.kind === "doc" ? <FileText className="size-4 text-muted-foreground" /> : <SheetIcon className="size-4 text-primary" />)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
            <span className="truncate">{title || "Untitled"}</span>
            {favorite ? <Star className="size-3.5 shrink-0 fill-warning text-warning" aria-label="Favorite" /> : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {meta} · {formatUpdatedAt(updatedAt)}
          </p>
        </div>
      </div>
      {item.kind === "doc" ? (
        <p className="mt-3 line-clamp-[8] whitespace-pre-line text-[13px] leading-5 text-muted-foreground">
          {item.doc.plainText.trim() || "Empty page"}
        </p>
      ) : (
        <SheetPeek sheet={item.sheet} />
      )}
    </RailSection>
  );
}

/** The first rows and columns of a sheet, as stored (formulas show their result on the sheet itself). */
function SheetPeek({ sheet }: { sheet: Sheet }) {
  const columns = sheet.columns.filter((column) => !column.hidden).slice(0, PREVIEW_COLS);
  const rows = sheet.rows.slice(0, PREVIEW_ROWS);
  if (columns.length === 0) return <p className="mt-3 text-xs text-muted-foreground">Empty sheet</p>;
  return (
    <div className="mt-3 overflow-hidden rounded-[8px] border border-border text-[11px]">
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="bg-muted/60 text-left text-muted-foreground">
            {columns.map((column) => (
              <th key={column.id} className="truncate px-2 py-1 font-medium">
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border text-foreground">
              {columns.map((column) => {
                const raw = row.cells[column.id] ?? "";
                return (
                  <td key={column.id} className="truncate px-2 py-1 tabular-nums">
                    {raw.startsWith("=") ? <span className="text-muted-foreground">ƒ</span> : raw}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr className="border-t border-border">
              <td colSpan={columns.length} className="px-2 py-1 text-muted-foreground">
                No rows yet
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {sheet.rows.length > PREVIEW_ROWS || sheet.columns.length > PREVIEW_COLS ? (
        <p className="border-t border-border px-2 py-1 text-muted-foreground">
          {sheet.rows.length > PREVIEW_ROWS ? `+${sheet.rows.length - PREVIEW_ROWS} rows` : ""}
          {sheet.rows.length > PREVIEW_ROWS && sheet.columns.length > PREVIEW_COLS ? " · " : ""}
          {sheet.columns.length > PREVIEW_COLS ? `+${sheet.columns.length - PREVIEW_COLS} columns` : ""}
        </p>
      ) : null}
    </div>
  );
}
