import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import {
  defaultCardSize,
  defaultQuery,
  describeQuery,
  fitQuery,
  type CardQuery,
  type DashboardCard,
  type DashboardData,
} from "@timely/contract/dashboard";
import {
  DOC_VIEW_HINTS,
  DOC_VIEW_LABELS,
  SHEET_VIEWS,
  SHEET_VIEW_HINTS,
  SHEET_VIEW_LABELS,
  computeSheetCard,
  docSections,
  fitSheetPick,
  parseRange,
  pickColumnIndexes,
  pickDocChecks,
  pickRangeText,
  previewGrid,
  repick,
  setPickTarget,
  sheetTabs,
  suggestSheetPick,
  toggleColumn,
  type DocPick,
  type DocView,
  type SheetPick,
} from "@timely/contract/dashboardFiles";
import { columnIndexToLetter } from "@timely/contract/sheetRefs";
import type { Sheet as ContractSheet } from "@timely/contract/sheet";
import type { Doc, Sheet } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet from "../ui/BottomSheet";
import SegmentedControl from "../ui/SegmentedControl";
import { Chip, Field, PrimaryButton, SectionLabel, Select } from "../ui/primitives";
import FileCardView, { FILE_ICON } from "./fileCards";

type Kind = "sheets" | "docs";

/**
 * Builds a dashboard card from one sheet or doc on the phone: pick the file,
 * then the cells (tap the first, then the last) or the part of the doc, then
 * how it shows. The same card definition as the desktop workshop writes.
 */
export default function FileCardBuilder({
  kind,
  data,
  onClose,
  onAdd,
}: {
  /** Null keeps the sheet closed. */
  kind: Kind | null;
  data: DashboardData;
  onClose: () => void;
  onAdd: (card: Omit<DashboardCard, "id">) => void;
}) {
  // The draft belongs to the kind it was started for; opening the other kind starts fresh.
  const [draft, setDraft] = useState<{ kind: Kind; query: CardQuery | null; title: string }>({ kind: "sheets", query: null, title: "" });
  const live = kind !== null && draft.kind === kind ? draft : { kind: kind ?? "sheets", query: null, title: "" };
  const close = () => {
    setDraft({ kind: kind ?? "sheets", query: null, title: "" });
    onClose();
  };
  return (
    <BottomSheet
      open={kind !== null}
      onClose={close}
      title={kind === "docs" ? "Card from a doc" : "Card from a sheet"}
      footer={
        live.query ? (
          <PrimaryButton
            label="Add to dashboard"
            onPress={() => {
              const query = live.query!;
              const size = defaultCardSize(query);
              onAdd({ type: "custom", title: live.title.trim() || undefined, query, w: size.w, h: size.h });
              setDraft({ kind: live.kind, query: null, title: "" });
            }}
          />
        ) : undefined
      }
    >
      {kind ? (
        <Builder
          kind={kind}
          data={data}
          query={live.query}
          title={live.title}
          setQuery={(query) => setDraft({ ...live, query })}
          setTitle={(title) => setDraft({ ...live, title })}
        />
      ) : null}
    </BottomSheet>
  );
}

function Builder({
  kind,
  data,
  query,
  title,
  setQuery,
  setTitle,
}: {
  kind: Kind;
  data: DashboardData;
  query: CardQuery | null;
  title: string;
  setQuery: (query: CardQuery) => void;
  setTitle: (title: string) => void;
}) {
  const files = useMemo(
    () =>
      ((kind === "sheets" ? data.sheets : data.docs) ?? [])
        .filter((file) => !file.archivedAt)
        .slice()
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
    [kind, data.sheets, data.docs],
  ) as unknown as (Sheet | Doc)[];
  const picked = query?.sheet?.sheetId ?? query?.doc?.docId ?? null;
  // The preview redraws after the tap's own change, so a tap shows at once.
  const previewQuery = useDeferredValue(query);

  const pickFile = (id: string) => {
    const file = files.find((entry) => entry.id === id);
    if (!file) return;
    if (kind === "sheets") {
      setQuery(fitQuery({ ...defaultQuery("sheets"), sheet: suggestSheetPick(file as unknown as ContractSheet) }));
    } else {
      const checks = pickDocChecks((file as Doc).content as never, {}).checks;
      setQuery(fitQuery({ ...defaultQuery("docs"), doc: { docId: file.id, fileTitle: file.title || undefined, view: checks.length > 0 ? "checklist" : "page" } }));
    }
  };

  const recent = files.slice(0, 6);
  const current = picked ? files.find((file) => file.id === picked) : undefined;
  const chips = current && !recent.includes(current) ? [current, ...recent.slice(0, 5)] : recent;
  const rest = files.filter((file) => !chips.includes(file));
  const untitled = kind === "sheets" ? "Untitled sheet" : "Untitled doc";

  return (
    <View style={{ gap: 16, paddingBottom: 8 }}>
      <View style={{ gap: 8 }}>
        <SectionLabel compact>{kind === "sheets" ? "Sheet" : "Doc"}</SectionLabel>
        {files.length === 0 ? (
          <Text style={styles.muted}>No {kind} yet. Make one in Files, then build a card from it.</Text>
        ) : (
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {chips.map((file) => (
              <Chip key={file.id} label={file.title || untitled} active={picked === file.id} onPress={() => pickFile(file.id)} />
            ))}
          </ScrollView>
        )}
        {rest.length > 0 ? (
          <Select
            label={`Another ${kind === "sheets" ? "sheet" : "doc"}`}
            value=""
            placeholder="Pick from all…"
            searchable
            onChange={pickFile}
            options={rest.map((file) => ({ value: file.id, label: file.title || untitled }))}
          />
        ) : null}
      </View>

      {query?.sheet && current ? (
        <SheetPicker sheet={current as unknown as ContractSheet} pick={query.sheet} onChange={(sheet) => setQuery(fitQuery({ ...query, sheet }))} />
      ) : null}
      {query?.doc && current ? <DocPicker doc={current as Doc} pick={query.doc} onChange={(doc) => setQuery(fitQuery({ ...query, doc }))} /> : null}

      {query ? (
        <>
          <Field label="Name" value={title} onChangeText={setTitle} placeholder={describeQuery(query)} autoCapitalize="sentences" />
          <View style={{ gap: 8 }}>
            <SectionLabel compact>Preview</SectionLabel>
            <View style={styles.preview}>
              <Text style={styles.previewTitle} numberOfLines={1}>
                {title.trim() || describeQuery(query)}
              </Text>
              {previewQuery ? <FileCardView query={previewQuery} data={data} preview /> : null}
            </View>
          </View>
        </>
      ) : files.length > 0 ? (
        <Text style={styles.muted}>Pick a {kind === "sheets" ? "sheet" : "doc"} to start.</Text>
      ) : null}
    </View>
  );
}

function SheetPicker({ sheet, pick, onChange }: { sheet: ContractSheet; pick: SheetPick; onChange: (pick: SheetPick) => void }) {
  const tabs = sheetTabs(sheet);
  const tabId = pick.tabId ?? tabs[0]?.id ?? "";
  const { grid, rows, cols } = useMemo(() => previewGrid(sheet, pick.tabId, 30, 8), [sheet, pick.tabId]);
  const [first, setFirst] = useState<{ r: number; c: number } | null>(null);
  const box = parseRange(pick.range);
  const result = useMemo(() => computeSheetCard(sheet, pick), [sheet, pick]);
  const byAddress = useMemo(() => new Map(grid.flat().map((cell) => [cell.address, cell])), [grid]);
  const letters = Array.from({ length: cols }, (_, index) => columnIndexToLetter(index)).filter((letter) => byAddress.has(`${letter}1`));
  const picked = useMemo(() => new Set(pickColumnIndexes(sheet, pick)), [sheet, pick]);
  const inBox = (r: number, c: number) => box !== null && picked.has(c) && r >= box.r0 && (box.r1 === null || r <= box.r1);
  const bodyRows = box && box.r1 !== null ? box.r1 - box.r0 + 1 : Infinity;

  // One stable handler for every cell, so a pick only redraws the cells it changes.
  const latest = useRef({ first, sheet, pick, onChange });
  latest.current = { first, sheet, pick, onChange };
  const tap = useCallback((r: number, c: number) => {
    const { first, sheet, pick, onChange } = latest.current;
    if (!first) {
      setFirst({ r, c });
      onChange(repick(sheet, pick, { r0: r, r1: r, c0: c, c1: c }));
      return;
    }
    setFirst(null);
    onChange(repick(sheet, pick, { r0: Math.min(first.r, r), r1: Math.max(first.r, r), c0: Math.min(first.c, c), c1: Math.max(first.c, c) }));
  }, []);

  return (
    <>
      {tabs.length > 1 ? (
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
          <SegmentedControl
            size="sm"
            value={tabId}
            onChange={(next) => {
              setFirst(null);
              onChange({ ...suggestSheetPick(sheet, next || undefined), view: pick.view });
            }}
            options={tabs.map((tab) => ({ value: tab.id, label: tab.name || "Untitled tab" }))}
          />
        </ScrollView>
      ) : null}
      <View style={{ gap: 8 }}>
        <View style={styles.pickHead}>
          <Text style={[styles.muted, { flex: 1 }]}>{first ? "Now tap the last cell. Tap the same one again for just that cell." : "Tap the first cell, then the last. Tap a column letter to add or leave out that column."}</Text>
          <Text style={styles.rangePill}>{pickRangeText(sheet, pick)}</Text>
        </View>
        {rows === 0 ? (
          <Text style={styles.muted}>This tab is empty.</Text>
        ) : (
          <ScrollView style={styles.gridWrap} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <ScrollView horizontal nestedScrollEnabled keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
              <View>
                <View style={[styles.gridRow, styles.gridHead]}>
                  <Text style={styles.rowNumber} />
                  {letters.map((letter) => {
                    const name = byAddress.get(`${letter}1`)?.column.name;
                    const c = parseRange(`${letter}1`)!.c0;
                    const on = picked.has(c);
                    return (
                      <AnimatedPressable
                        key={letter}
                        accessibilityRole="button"
                        accessibilityLabel={`Column ${letter}${name && name !== letter ? `, ${name}` : ""}`}
                        accessibilityHint={on ? "Leaves this column out of the card" : "Adds this column to the card"}
                        accessibilityState={{ selected: on }}
                        onPress={() => {
                          setFirst(null);
                          onChange(toggleColumn(sheet, pick, c));
                        }}
                        style={[styles.colHeadButton, on && styles.colHeadOn]}
                      >
                        <Text style={[styles.colHead, on && styles.colHeadTextOn]} numberOfLines={1}>
                          {letter}
                          {name && name !== letter ? <Text style={[styles.colName, on && styles.colNameOn]}> {name}</Text> : null}
                        </Text>
                      </AnimatedPressable>
                    );
                  })}
                </View>
                {Array.from({ length: rows }, (_, r) => (
                  <View key={r} style={styles.gridRow}>
                    <Text style={styles.rowNumber}>{r + 1}</Text>
                    {letters.map((letter) => {
                      const cell = byAddress.get(`${letter}${r + 1}`);
                      const c = parseRange(`${letter}1`)!.c0;
                      const on = inBox(r, c);
                      const start = first && first.r === r && first.c === c;
                      return (
                        <GridCell
                          key={letter}
                          r={r}
                          c={c}
                          label={`${letter}${r + 1}${cell?.text ? `: ${cell.text}` : ""}`}
                          text={cell?.text || " "}
                          numeric={cell?.number !== null && cell?.number !== undefined}
                          on={on}
                          start={Boolean(start)}
                          bold={Boolean(on && pick.headers && box && r === box.r0)}
                          onTap={tap}
                        />
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </ScrollView>
        )}
        <View style={styles.toggles}>
          <Chip label="First row is names" active={Boolean(pick.headers)} onPress={() => bodyRows >= 2 && onChange(fitSheetPick({ ...pick, headers: pick.headers ? undefined : true }))} />
          <Chip label="Keep reading rows added below" active={Boolean(pick.grow)} onPress={() => onChange(fitSheetPick({ ...pick, grow: pick.grow ? undefined : true }))} />
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <SectionLabel compact>Show as</SectionLabel>
        <View style={styles.tiles}>
          {SHEET_VIEWS.map((view) => {
            const Icon = FILE_ICON[view];
            const on = pick.view === view;
            return (
              <AnimatedPressable key={view} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(fitSheetPick({ ...pick, view }))} style={[styles.tile, on && styles.tileOn]}>
                <Icon size={18} color={on ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.tileText, on && styles.tileTextOn]} numberOfLines={1}>
                  {SHEET_VIEW_LABELS[view]}
                </Text>
              </AnimatedPressable>
            );
          })}
        </View>
        {result.kind === "counter" && (!result.cell || result.cell.formula) ? (
          // A counter on a formula has no − and +, on the card or its widget.
          <Text style={styles.warning}>
            {result.cell ? `${result.cell.address} is a formula, so a counter can't add to it.` : "Pick a cell first."} Tap a cell with a plain number.
          </Text>
        ) : (
          <Text style={styles.muted}>{SHEET_VIEW_HINTS[pick.view]}</Text>
        )}
        {pick.view === "progress" ? (
          <Field
            label="Goal"
            value={pick.target ?? ""}
            onChangeText={(target) => onChange(setPickTarget(sheet, pick, target))}
            placeholder="2000 or B7"
            autoCapitalize="none"
            hint={result.kind === "progress" && result.target > 0 ? `Goal is ${result.targetText}.` : "A number, or a cell on this tab such as B7."}
          />
        ) : null}
        {pick.view === "counter" ? (
          <Field
            label="Each tap adds"
            value={String(pick.step ?? 1)}
            keyboardType="decimal-pad"
            onChangeText={(text) => {
              const step = Number(text);
              onChange(fitSheetPick({ ...pick, step: Number.isFinite(step) && step > 0 ? step : undefined }));
            }}
          />
        ) : null}
        {pick.view === "table" ? (
          <View style={styles.toggles}>
            <Chip label="Edit values on the card" active={Boolean(pick.editable)} onPress={() => onChange(fitSheetPick({ ...pick, editable: pick.editable ? undefined : true }))} />
          </View>
        ) : null}
        {pick.view === "addRow" && result.kind === "addRow" ? (
          <Text style={styles.muted}>New rows go right below {result.afterLabel}, so totals under the cells grow to include them.</Text>
        ) : null}
      </View>
    </>
  );
}

/**
 * One cell of the pick grid. A plain Pressable, memoised: the grid holds up to
 * 240 of them, and redrawing them all (each with its own press animation) on
 * every tap made the builder lag on slower phones.
 */
const GridCell = memo(function GridCell({
  r,
  c,
  label,
  text,
  numeric,
  on,
  start,
  bold,
  onTap,
}: {
  r: number;
  c: number;
  label: string;
  text: string;
  numeric: boolean;
  on: boolean;
  start: boolean;
  bold: boolean;
  onTap: (r: number, c: number) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={() => onTap(r, c)}
      style={({ pressed }) => [styles.cell, on && styles.cellOn, pressed && styles.cellPressed, start && styles.cellStart]}
    >
      <Text style={[styles.cellText, numeric && styles.right, bold && styles.bold]} numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
});

function DocPicker({ doc, pick, onChange }: { doc: Doc; pick: DocPick; onChange: (pick: DocPick) => void }) {
  const content = doc.content as never;
  const sections = useMemo(() => docSections(content), [content]);
  const all = useMemo(() => pickDocChecks(content, {}).checks, [content]);
  const tally = (count: number, done: number) => (count === 0 ? "" : `${done}/${count}`);
  return (
    <>
      <View style={{ gap: 4 }}>
        <SectionLabel compact>Part of the doc</SectionLabel>
        <SectionRow title="Whole doc" meta={tally(all.length, all.filter((check) => check.checked).length)} active={!pick.section} level={1} onPress={() => onChange({ ...pick, section: undefined })} />
        {sections.map((section, index) => (
          <SectionRow
            key={`${section.text}-${index}`}
            title={section.text}
            meta={tally(section.checks, section.done)}
            active={pick.section === section.text}
            level={section.level}
            onPress={() => onChange({ ...pick, section: section.text })}
          />
        ))}
      </View>
      <View style={{ gap: 8 }}>
        <SectionLabel compact>Show as</SectionLabel>
        <SegmentedControl<DocView>
          value={pick.view}
          onChange={(view) => onChange({ ...pick, view })}
          options={(Object.keys(DOC_VIEW_LABELS) as DocView[]).map((view) => ({ value: view, label: DOC_VIEW_LABELS[view] }))}
        />
        <Text style={styles.muted}>{DOC_VIEW_HINTS[pick.view]}</Text>
        {pick.view === "checklist" ? (
          <View style={styles.toggles}>
            <Chip label="Hide ticked items" active={Boolean(pick.hideDone)} onPress={() => onChange({ ...pick, hideDone: pick.hideDone ? undefined : true })} />
          </View>
        ) : null}
      </View>
    </>
  );
}

function SectionRow({ title, meta, active, level, onPress }: { title: string; meta: string; active: boolean; level: number; onPress: () => void }) {
  return (
    <AnimatedPressable accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={onPress} style={[styles.sectionRow, active && styles.sectionOn, { paddingLeft: 12 + Math.max(0, level - 1) * 14 }]}>
      <Text style={[styles.sectionText, level <= 1 && styles.bold]} numberOfLines={1}>
        {title}
      </Text>
      {meta ? <Text style={styles.muted}>{meta}</Text> : null}
      {active ? <Check size={16} color={colors.primary} /> : <View style={{ width: 16 }} />}
    </AnimatedPressable>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  muted: { color: colors.mutedForeground, fontSize: 13 },
  warning: { color: colors.warning, fontSize: 13 },
  chips: { gap: 8, paddingRight: 8 },
  pickHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  rangePill: { color: colors.foreground, fontSize: 13, fontVariant: ["tabular-nums"], backgroundColor: colors.muted, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: "hidden" },
  gridWrap: { maxHeight: 280, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  gridRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border },
  gridHead: { borderTopWidth: 0, backgroundColor: colors.muted },
  rowNumber: { width: 30, textAlign: "center", textAlignVertical: "center", color: colors.mutedForeground, fontSize: 12, paddingVertical: 10, backgroundColor: colors.muted },
  colHeadButton: { width: 96, minHeight: 40, justifyContent: "center" },
  colHeadOn: { backgroundColor: `${colors.primary}26` },
  colHead: { paddingHorizontal: 8, color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  colHeadTextOn: { color: colors.primary },
  colName: { fontWeight: "400" },
  colNameOn: { color: colors.foreground },
  cell: { width: 96, minHeight: 40, paddingHorizontal: 8, justifyContent: "center" },
  cellOn: { backgroundColor: `${colors.primary}1f` },
  cellPressed: { backgroundColor: `${colors.primary}33` },
  cellStart: { borderWidth: 2, borderColor: colors.primary, borderRadius: 4 },
  cellText: { color: colors.foreground, fontSize: 13, fontVariant: ["tabular-nums"] },
  right: { textAlign: "right" },
  bold: { fontWeight: "600" },
  toggles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "23%", flexGrow: 1, alignItems: "center", gap: 4, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  tileOn: { borderColor: colors.primary, backgroundColor: `${colors.primary}14` },
  tileText: { color: colors.mutedForeground, fontSize: 12 },
  tileTextOn: { color: colors.primary, fontWeight: "600" },
  preview: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14, gap: 12 },
  previewTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingRight: 12, borderRadius: 10 },
  sectionOn: { backgroundColor: `${colors.primary}14` },
  sectionText: { flex: 1, color: colors.foreground, fontSize: 15 },
}));
