"use client";

import DocPage from "@/app/_components/docs/docPage";
import SheetPage from "@/app/_components/sheets/sheetPage";
import SheetTemplatePage from "@/app/_components/sheets/sheetTemplatePage";
import { fileKind } from "@/app/utils/fileRoutes";

/** A doc, sheet or sheet template, told apart by its ID prefix. */
export default function FileView({ id }: { id: string }) {
  const kind = fileKind(id);
  if (kind === "template") return <SheetTemplatePage id={id} />;
  if (kind === "sheet") return <SheetPage id={id} />;
  return <DocPage id={id} />;
}
