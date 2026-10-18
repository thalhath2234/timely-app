"use client";

import { LayoutTemplate, Library } from "lucide-react";
import { RailEmpty, RailRow, RailRows, RailSection } from "@/app/_components/_ui/pageWithRail";
import type { Doc, Sheet, SheetTemplate } from "@/app/_types/types";
import { plural } from "@/app/utils/plural";

/** The Files start page rail: one tap to a new sheet from each template,
 * and what the library holds. */
export default function FilesRail({
  docs,
  sheets,
  templates,
  creating,
  onCreateFromTemplate,
}: {
  docs: Doc[];
  sheets: Sheet[];
  templates: SheetTemplate[];
  creating: boolean;
  onCreateFromTemplate: (templateId: string) => void;
}) {
  const liveDocs = docs.filter((doc) => !doc.archivedAt);
  const liveSheets = sheets.filter((sheet) => !sheet.archivedAt);
  const favorites = liveDocs.filter((doc) => doc.isFavorite).length + liveSheets.filter((sheet) => sheet.isFavorite).length;
  const archived = docs.length - liveDocs.length + (sheets.length - liveSheets.length);
  const docTemplates = liveDocs.filter((doc) => doc.isTemplate).length;

  return (
    <>
      <RailSection
        title="New sheet from a template"
        icon={<LayoutTemplate className="size-3.5 text-primary" />}
        meta={creating ? "Creating…" : undefined}
        data-testid="files-templates"
      >
        {templates.length === 0 ? (
          <RailEmpty>Save any sheet as a template from its tab menu and it will be offered here.</RailEmpty>
        ) : (
          <RailRows>
            {templates.map((template) => (
              <RailRow
                key={template.id}
                label={`${template.icon ? `${template.icon} ` : ""}${template.name}`}
                meta={`${plural(template.columns.length, "column")} · ${plural(template.rows.length, "row")}`}
                value="+"
                tone="primary"
                onClick={() => onCreateFromTemplate(template.id)}
              />
            ))}
          </RailRows>
        )}
      </RailSection>

      <RailSection title="Library" icon={<Library className="size-3.5 text-muted-foreground" />} data-testid="files-library">
        <RailRows>
          <RailRow label="Docs" value={liveDocs.length} />
          <RailRow label="Sheets" value={liveSheets.length} />
          <RailRow label="Favorites" value={favorites} />
          <RailRow label="Templates" meta="docs and sheets" value={docTemplates + templates.length} />
          {archived > 0 ? <RailRow label="Archived" value={archived} tone="muted" /> : null}
        </RailRows>
      </RailSection>
    </>
  );
}
