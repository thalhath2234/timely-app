"use client";

import { useMemo } from "react";
import type { KnowledgeInput, KnowledgeView } from "@timely/contract/bots";
import { ListRow } from "@/app/_components/_ui/groupedList";
import Select, { type SelectOption } from "@/app/_components/_ui/select";
import { useDocs } from "@/app/utils/hooks/docs";
import { useSheets } from "@/app/utils/hooks/sheets";

const NONE = "none";
const HINT = "Only the AI judge reads it, each check, as data.";

const keyOf = (k: KnowledgeInput | null | undefined) =>
  k ? `${k.kind}:${k.id}` : NONE;

function parse(value: string): KnowledgeInput | null {
  const at = value.indexOf(":");
  if (value === NONE || at < 0) return null;
  const kind = value.slice(0, at);
  if (kind !== "doc" && kind !== "sheet") return null;
  return { kind, id: value.slice(at + 1) };
}

/**
 * Knowledge, under How smart on an AI-judged bot: one doc or sheet (a
 * wishlist with the most the person will pay) that the judge reads each
 * check, as data. Docs and sheets come from the account's own lists.
 */
export function KnowledgeRow({
  value,
  view,
  onChange,
}: {
  value: KnowledgeInput | null;
  /** The saved bot's knowledge: its title, and whether it was deleted or archived. */
  view?: KnowledgeView | null;
  onChange: (next: KnowledgeInput | null) => void;
}) {
  const docs = useDocs().data;
  const sheets = useSheets().data;
  const current = keyOf(value);
  const saved = view && keyOf(view) === current ? view : null;

  const options = useMemo(() => {
    const out: SelectOption[] = [{ value: NONE, label: "None" }];
    for (const d of docs ?? []) {
      if (d.archivedAt || d.isTemplate) continue;
      out.push({
        value: `doc:${d.id}`,
        label: d.title.trim() || "Untitled doc",
        group: "Docs",
      });
    }
    for (const s of sheets ?? []) {
      if (s.archivedAt) continue;
      out.push({
        value: `sheet:${s.id}`,
        label: s.title.trim() || "Untitled sheet",
        group: "Sheets",
      });
    }
    // A pick that is not listed (deleted, archived, or the lists still
    // loading) still shows its name.
    if (current !== NONE && !out.some((o) => o.value === current)) {
      const kind = value?.kind === "sheet" ? "Sheets" : "Docs";
      out.push({
        value: current,
        label:
          saved?.title.trim() ||
          (value?.kind === "sheet" ? "A sheet" : "A doc"),
        group: kind,
      });
    }
    return out;
  }, [docs, sheets, current, value?.kind, saved?.title]);

  return (
    <ListRow
      label="Knowledge"
      meta={
        saved?.missing ? (
          <>
            <span className="text-destructive">Missing</span> · {HINT}
          </>
        ) : (
          HINT
        )
      }
    >
      <Select
        variant="row"
        aria-label="Knowledge"
        searchable
        value={current}
        options={options}
        menuMinWidth={240}
        onChange={(next) => onChange(parse(next))}
      />
    </ListRow>
  );
}
