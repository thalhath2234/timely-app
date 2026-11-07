import { useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { Check, FileText, Sheet as SheetIcon } from "lucide-react-native";
import type { KnowledgeInput, KnowledgeView } from "@timely/contract/bots";
import BottomSheet from "../ui/BottomSheet";
import { Field } from "../ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../settings/SettingsList";
import { useDocsQuery, useSheetsQuery } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";

const HINT = "Only the AI judge reads it, each check, as data.";
/** Past this many docs and sheets the page gets a filter box. */
const SEARCH_FROM = 8;

type Pick = { kind: "doc" | "sheet"; id: string; title: string };

const same = (a: KnowledgeInput | null | undefined, b: KnowledgeInput | null | undefined) =>
  (!a && !b) || (!!a && !!b && a.kind === b.kind && a.id === b.id);

/** The account's docs and sheets that can be picked (not archived, not templates). */
function usePicks(): { docs: Pick[]; sheets: Pick[] } {
  const docs = useDocsQuery().data;
  const sheets = useSheetsQuery().data;
  return useMemo(
    () => ({
      docs: (docs ?? [])
        .filter((d) => !d.archivedAt && !d.isTemplate)
        .map((d) => ({ kind: "doc" as const, id: d.id, title: d.title.trim() || "Untitled doc" })),
      sheets: (sheets ?? []).filter((s) => !s.archivedAt).map((s) => ({ kind: "sheet" as const, id: s.id, title: s.title.trim() || "Untitled sheet" })),
    }),
    [docs, sheets],
  );
}

/**
 * Knowledge, under How smart on an AI-judged bot: one doc or sheet (a
 * wishlist with the most the person will pay) that the judge reads each
 * check, as data. The row names the pick, or says it is missing (deleted or
 * archived); it opens a page listing the account's docs and sheets.
 */
export function KnowledgeRow({
  value,
  view,
  onChange,
}: {
  value: KnowledgeInput | null | undefined;
  /** The saved bot's knowledge: its title, and whether it was deleted or archived. */
  view?: KnowledgeView | null;
  onChange: (next: KnowledgeInput | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const picks = usePicks();
  const saved = view && same(view, value) ? view : null;
  const listed = value ? (value.kind === "doc" ? picks.docs : picks.sheets).find((p) => p.id === value.id) : undefined;
  const name = !value ? "None" : listed?.title || saved?.title.trim() || (value.kind === "sheet" ? "A sheet" : "A doc");
  return (
    <>
      <ListRow
        title="Knowledge"
        meta={HINT}
        accessibilityLabel={`Knowledge, ${saved?.missing ? `${name}, missing` : name}`}
        trailing={
          <Text numberOfLines={1} style={styles.value}>
            {saved?.missing ? <Text style={styles.missing}>Missing · </Text> : null}
            {name}
          </Text>
        }
        onPress={() => setOpen(true)}
      />
      {open ? (
        <KnowledgePage
          value={value ?? null}
          picks={picks}
          missing={saved?.missing ? saved : null}
          onClose={() => setOpen(false)}
          onPick={(next) => {
            setOpen(false);
            if (!same(next, value)) onChange(next);
          }}
        />
      ) : null}
    </>
  );
}

/** The page of picks: None, then Docs and Sheets, with a filter box for a long list. */
function KnowledgePage({
  value,
  picks,
  missing,
  onPick,
  onClose,
}: {
  value: KnowledgeInput | null;
  picks: { docs: Pick[]; sheets: Pick[] };
  /** The saved pick when it was deleted or archived, so it still shows as chosen. */
  missing: KnowledgeView | null;
  onPick: (next: KnowledgeInput | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const match = (p: Pick) => !needle || p.title.toLowerCase().includes(needle);
  const total = picks.docs.length + picks.sheets.length;
  const row = (p: Pick, Icon: typeof FileText, meta?: string): ReactElement => {
    const on = same(p, value);
    return (
      <ListRow
        key={`${p.kind}:${p.id}`}
        title={p.title}
        meta={meta}
        leading={<Icon size={18} color={colors.mutedForeground} />}
        trailing={on ? <Check size={18} color={colors.primary} strokeWidth={2.5} /> : undefined}
        accessibilityLabel={on ? `${p.title}, chosen` : p.title}
        chevron={false}
        onPress={() => onPick({ kind: p.kind, id: p.id })}
      />
    );
  };
  const docs = picks.docs.filter(match);
  const sheets = picks.sheets.filter(match);
  return (
    <BottomSheet open onClose={onClose} title="Knowledge">
      <View style={styles.body}>
        {total > SEARCH_FROM ? (
          <Field value={query} onChangeText={setQuery} placeholder="Find a doc or sheet" accessibilityLabel="Find a doc or sheet" autoCapitalize="none" />
        ) : null}
        <View style={styles.section}>
          <ListGroup>
            <ListRow
              title="None"
              trailing={!value ? <Check size={18} color={colors.primary} strokeWidth={2.5} /> : undefined}
              accessibilityLabel={!value ? "None, chosen" : "None"}
              chevron={false}
              onPress={() => onPick(null)}
            />
            {missing && !needle ? row({ kind: missing.kind, id: missing.id, title: missing.title.trim() || "Untitled" }, missing.kind === "sheet" ? SheetIcon : FileText, "Missing: deleted or archived") : null}
          </ListGroup>
          <GroupHint>{HINT}</GroupHint>
        </View>
        {docs.length ? (
          <View style={styles.section}>
            <GroupLabel>Docs</GroupLabel>
            <ListGroup>{docs.map((p) => row(p, FileText))}</ListGroup>
          </View>
        ) : null}
        {sheets.length ? (
          <View style={styles.section}>
            <GroupLabel>Sheets</GroupLabel>
            <ListGroup>{sheets.map((p) => row(p, SheetIcon))}</ListGroup>
          </View>
        ) : null}
        {needle && !docs.length && !sheets.length ? <GroupHint>No doc or sheet matches.</GroupHint> : null}
        {!needle && total === 0 ? <GroupHint>No docs or sheets yet. Make one in Docs or Sheets, then pick it here.</GroupHint> : null}
      </View>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { gap: 14, paddingTop: 4, paddingBottom: 8 },
  section: { gap: 6 },
  value: { flexShrink: 1, maxWidth: 160, color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  missing: { color: colors.destructive, fontWeight: "600" },
}));
