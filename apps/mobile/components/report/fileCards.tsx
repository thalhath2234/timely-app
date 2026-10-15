import { useEffect, useMemo, useState } from "react";
import { AppState, ScrollView, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  BarChart3,
  Check,
  ExternalLink,
  FileText,
  Gauge,
  Hash,
  LineChart as LineIcon,
  ListChecks,
  ListPlus,
  Minus,
  PieChart,
  Plus,
  Table2,
  Tally5,
} from "lucide-react-native";
import type { CardQuery, DashboardCard, DashboardData } from "@timely/contract/dashboard";
import {
  addPickRow,
  computeSheetCard,
  formatLike,
  pickDocBlocks,
  pickDocChecks,
  setPickCell,
  toggleDocCheck,
  type AddRowField,
  type DocPick,
  type DocView,
  type PickCell,
  type SheetCardResult,
  type SheetPick,
  type SheetView,
  pickRangeText,
} from "@timely/contract/dashboardFiles";
import type { DocContent } from "@timely/contract/documents";
import type { Sheet as ContractSheet } from "@timely/contract/sheet";
import { updateDoc, watchDoc } from "../../lib/api/docs";
import { updateSheet, watchSheet, type UpdateSheetPayload } from "../../lib/api/sheets";
import { seriesColor } from "../../lib/dashboard";
import { fileHref } from "../../lib/fileRoutes";
import { keys } from "../../lib/hooks";
import { useToastStore } from "../../lib/toast";
import type { Doc, Sheet } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet from "../ui/BottomSheet";
import { DateField } from "../ui/DateTimeField";
import { Button, Field, PrimaryButton, Select } from "../ui/primitives";
import { CategoryBars, DonutChart, LineChart, Meter } from "./charts";

export const FILE_ICON: Record<SheetView | DocView, typeof Hash> = {
  value: Hash,
  table: Table2,
  bar: BarChart3,
  line: LineIcon,
  pie: PieChart,
  progress: Gauge,
  counter: Tally5,
  addRow: ListPlus,
  page: FileText,
  checklist: ListChecks,
};

/** True for a custom card that reads one sheet or one doc. */
export function isFileQuery(query: CardQuery | undefined): query is CardQuery & ({ sheet: SheetPick } | { doc: DocPick }) {
  return Boolean(query?.sheet || query?.doc);
}

/**
 * Keeps the sheets and docs that cards read up to date, whoever changes them
 * (this phone, the desktop, an agent): one watch stream per picked file, each
 * save landing in the query cache the cards draw from.
 */
export function useFileWatches(cards: DashboardCard[]) {
  const client = useQueryClient();
  const ids = useMemo(() => {
    const sheets = new Set<string>();
    const docs = new Set<string>();
    for (const card of cards) {
      if (card.query?.sheet?.sheetId) sheets.add(card.query.sheet.sheetId);
      if (card.query?.doc?.docId) docs.add(card.query.doc.docId);
    }
    return { sheets: [...sheets].sort().join(","), docs: [...docs].sort().join(",") };
  }, [cards]);

  useEffect(() => {
    const stops: (() => void)[] = [];
    for (const id of ids.sheets.split(",").filter(Boolean)) {
      stops.push(
        watchSheet(id, (event) => {
          if (event.type === "deleted") return void client.invalidateQueries({ queryKey: keys.sheets });
          if (event.type !== "updated" || !event.document) return;
          const sheet = event.document;
          client.setQueryData(keys.sheet(id), sheet);
          client.setQueryData<Sheet[]>(keys.sheets, (list) => list?.map((item) => (item.id === id ? sheet : item)));
        }),
      );
    }
    for (const id of ids.docs.split(",").filter(Boolean)) {
      stops.push(
        watchDoc(id, (event) => {
          if (event.type === "deleted") return void client.invalidateQueries({ queryKey: keys.docs });
          if (event.type !== "updated" || !event.document) return;
          const doc = event.document;
          client.setQueryData(keys.doc(id), doc);
          client.setQueryData<Doc[]>(keys.docs, (list) => list?.map((item) => (item.id === id ? doc : item)));
        }),
      );
    }
    // Streams miss what happened while the app slept; catch up when it is back.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (ids.sheets) void client.invalidateQueries({ queryKey: keys.sheets, exact: true });
      if (ids.docs) void client.invalidateQueries({ queryKey: keys.docs, exact: true });
    });
    return () => {
      for (const stop of stops) stop();
      subscription.remove();
    };
  }, [ids, client]);
}

function useSheetWrite() {
  const client = useQueryClient();
  return async (before: Sheet, change: { payload: UpdateSheetPayload; sheet: ContractSheet } | null, done?: string) => {
    if (!change) return false;
    const put = (sheet: Sheet) => {
      client.setQueryData(keys.sheet(sheet.id), sheet);
      client.setQueryData<Sheet[]>(keys.sheets, (list) => list?.map((item) => (item.id === sheet.id ? sheet : item)));
    };
    put(change.sheet as unknown as Sheet);
    try {
      put(await updateSheet(before.id, change.payload));
      if (done) useToastStore.getState().show(done);
      return true;
    } catch (error) {
      put(before);
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not save to the sheet");
      return false;
    }
  };
}

function useDocWrite() {
  const client = useQueryClient();
  return async (before: Doc, content: DocContent) => {
    const put = (doc: Doc) => {
      client.setQueryData(keys.doc(doc.id), doc);
      client.setQueryData<Doc[]>(keys.docs, (list) => list?.map((item) => (item.id === doc.id ? doc : item)));
    };
    put({ ...before, content } as Doc);
    try {
      put(await updateDoc(before.id, { content }));
    } catch (error) {
      put(before);
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not save to the doc");
    }
  };
}

/** A card built from one sheet or one doc. `preview` draws it without writing back (the builder). */
export default function FileCardView({ query, data, preview = false }: { query: CardQuery; data: DashboardData; preview?: boolean }) {
  if (query.sheet) {
    const sheet = (data.sheets ?? []).find((entry) => entry.id === query.sheet!.sheetId) as unknown as Sheet | undefined;
    return <SheetCard pick={query.sheet} sheet={sheet} color={query.color ?? 0} preview={preview} />;
  }
  if (query.doc) {
    const doc = (data.docs ?? []).find((entry) => entry.id === query.doc!.docId) as unknown as Doc | undefined;
    return <DocCard pick={query.doc} doc={doc} preview={preview} />;
  }
  return null;
}

function Footer({ label, id, preview }: { label: string; id?: string; preview: boolean }) {
  const router = useRouter();
  return (
    <View style={styles.footer}>
      <Text style={styles.small} numberOfLines={1}>
        {label}
      </Text>
      {id && !preview ? (
        <AnimatedPressable accessibilityRole="link" accessibilityLabel={`Open ${label}`} hitSlop={8} onPress={() => router.push(fileHref(id))} style={styles.open}>
          <ExternalLink size={13} color={colors.mutedForeground} />
          <Text style={styles.small}>Open</Text>
        </AnimatedPressable>
      ) : null}
    </View>
  );
}

function SheetCard({ pick, sheet, color, preview }: { pick: SheetPick; sheet: Sheet | undefined; color: number; preview: boolean }) {
  const write = useSheetWrite();
  const contract = sheet as unknown as ContractSheet | undefined;
  const result = useMemo(() => computeSheetCard(contract, pick), [contract, pick]);
  const label = `${sheet?.title || pick.fileTitle || "Sheet"} · ${pickRangeText(contract, pick)}`;
  const setCell = (cell: PickCell, input: string, done?: string) =>
    sheet && contract && !preview ? write(sheet, setPickCell(contract, pick.tabId, cell.rowId, cell.colId, input), done) : Promise.resolve(false);
  const addRow = (values: Record<string, string>) =>
    sheet && contract && !preview ? write(sheet, addPickRow(contract, pick, values), `Added a row to ${sheet.title || "the sheet"}`) : Promise.resolve(false);
  return (
    <View style={{ gap: 10 }}>
      <SheetBody result={result} color={color} preview={preview} onSetCell={setCell} onAddRow={addRow} />
      <Footer label={label} id={result.kind === "missing" ? undefined : sheet?.id} preview={preview} />
    </View>
  );
}

function SheetBody({
  result,
  color,
  preview,
  onSetCell,
  onAddRow,
}: {
  result: SheetCardResult;
  color: number;
  preview: boolean;
  onSetCell: (cell: PickCell, input: string, done?: string) => Promise<boolean>;
  onAddRow: (values: Record<string, string>) => Promise<boolean>;
}) {
  switch (result.kind) {
    case "missing":
      return <Text style={styles.empty}>{result.message}</Text>;
    case "value":
      return (
        <View>
          <View style={styles.numberRow}>
            <View style={[styles.numberMark, { backgroundColor: seriesColor(color) }]} />
            <Text style={styles.number} numberOfLines={1} adjustsFontSizeToFit>
              {result.text || "—"}
            </Text>
          </View>
          {result.count > 1 ? <Text style={[styles.small, { marginTop: 6 }]}>Total of {result.count} cells</Text> : null}
        </View>
      );
    case "counter": {
      const locked = !result.cell || result.cell.formula;
      const bump = (by: number) => {
        if (!result.cell) return;
        const next = Math.round((result.value + by) * 1e6) / 1e6;
        void onSetCell(result.cell, String(next));
      };
      return (
        <View style={{ gap: 6 }}>
          <View style={styles.counterRow}>
            <Button label={`Take away ${result.step}`} iconOnly variant="outline" icon={<Minus size={20} color={colors.foreground} />} disabled={locked || preview} onPress={() => bump(-result.step)} />
            <Text style={styles.counterValue}>{result.text}</Text>
            <Button label={`Add ${result.step}`} iconOnly icon={<Plus size={20} color={colors.primaryForeground} />} disabled={locked || preview} onPress={() => bump(result.step)} />
          </View>
          <Text style={[styles.small, { textAlign: "center" }]}>{locked ? "This cell is a formula, so it can't count." : "Saves into the sheet"}</Text>
        </View>
      );
    }
    case "progress": {
      const share = result.target > 0 ? result.value / result.target : 0;
      return (
        <View style={{ gap: 8 }}>
          <View style={styles.progressHead}>
            <Text style={styles.percent}>{result.target > 0 ? `${Math.round(share * 100)}%` : "—"}</Text>
            <Text style={styles.small}>{result.target > 0 ? `${result.valueText} of ${result.targetText}` : "Set a goal in the card's settings"}</Text>
          </View>
          <Meter value={share} color={color} />
        </View>
      );
    }
    case "chart": {
      const series = result.series.filter((entry) => entry.points.length > 0);
      if (series.length === 0) return <Text style={styles.empty}>No numbers in these cells yet.</Text>;
      const format = (value: number) => formatLike(value, result.column);
      if (result.view === "pie") {
        const points = series[0].points;
        return <DonutChart points={points} unit="count" total={points.reduce((sum, point) => sum + point.value, 0)} format={format} />;
      }
      if (result.view === "line") return <LineChart points={series[0].points} unit="count" color={color} format={format} />;
      if (series.length === 1) return <CategoryBars points={series[0].points} unit="count" color={color} format={format} />;
      return <GroupedBars series={series} color={color} format={format} />;
    }
    case "table":
      return <SheetTable result={result} preview={preview} onSetCell={onSetCell} />;
    case "addRow":
      return <AddRowForm fields={result.fields} preview={preview} onAdd={onAddRow} tabName={result.tabName} />;
  }
}

/** One row per name with a thin bar for each value column, and a legend for the columns. */
function GroupedBars({ series, color, format }: { series: { name: string; points: { key: string; label: string; value: number; text: string }[] }[]; color: number; format: (value: number) => string }) {
  const max = Math.max(...series.flatMap((entry) => entry.points.map((point) => point.value)), 0) || 1;
  const rows = series[0].points.map((point, index) => ({ key: point.key, label: point.label, values: series.map((entry) => entry.points[index]) }));
  return (
    <View style={{ gap: 10 }}>
      {rows.map((row) => (
        <View key={row.key} style={{ gap: 3 }}>
          <Text style={styles.barLabel} numberOfLines={1}>
            {row.label}
          </Text>
          {row.values.map((point, index) => (
            <View key={index} style={styles.groupRow}>
              <View style={{ flex: 1 }}>
                <View style={[styles.groupBar, { width: `${Math.max(((point?.value ?? 0) / max) * 100, 1)}%`, backgroundColor: seriesColor(color + index) }]} />
              </View>
              <Text style={styles.groupValue}>{point ? point.text || format(point.value) : ""}</Text>
            </View>
          ))}
        </View>
      ))}
      <View style={styles.legend}>
        {series.map((entry, index) => (
          <View key={entry.name} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: seriesColor(color + index) }]} />
            <Text style={styles.small}>{entry.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const NUMERIC = ["number", "currency", "percent", "formula"];

function SheetTable({
  result,
  preview,
  onSetCell,
}: {
  result: Extract<SheetCardResult, { kind: "table" }>;
  preview: boolean;
  onSetCell: (cell: PickCell, input: string, done?: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<PickCell | null>(null);
  const [draft, setDraft] = useState("");
  const canEdit = (cell: PickCell) => result.editable && !preview && !cell.formula;
  if (result.rows.length === 0) return <Text style={styles.empty}>These cells are empty.</Text>;
  const width = (index: number) => (index === 0 ? 120 : 96);
  return (
    <>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
        <View style={styles.table}>
          {result.headers ? (
            <View style={[styles.tableRow, styles.tableHead]}>
              {result.headers.map((header, index) => (
                <Text key={index} style={[styles.headCell, { width: width(index) }, result.columns[index] && NUMERIC.includes(result.columns[index].type) && styles.right]} numberOfLines={1}>
                  {header}
                </Text>
              ))}
            </View>
          ) : null}
          {result.rows.map((row, rowIndex) => (
            <View key={row[0]?.rowId ?? rowIndex} style={[styles.tableRow, rowIndex > 0 && styles.rowDivider]}>
              {row.map((cell, index) => {
                const editable = canEdit(cell);
                const numeric = cell.number !== null || NUMERIC.includes(cell.column.type);
                const text = <Text style={[styles.cell, numeric && styles.right, cell.formula && styles.mutedCell]} numberOfLines={1}>{cell.text || " "}</Text>;
                if (!editable) return <View key={cell.colId} style={[styles.cellBox, { width: width(index) }]}>{text}</View>;
                return (
                  <AnimatedPressable
                    key={cell.colId}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${cell.address}: ${cell.text || "empty"}`}
                    onPress={() => {
                      if (cell.column.type === "boolean") {
                        const on = cell.value.type === "boolean" ? cell.value.value : /^true$/i.test(cell.raw);
                        void onSetCell(cell, on ? "FALSE" : "TRUE");
                        return;
                      }
                      setDraft(cell.raw);
                      setEditing(cell);
                    }}
                    style={[styles.cellBox, styles.editable, { width: width(index) }]}
                  >
                    {text}
                  </AnimatedPressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      {result.editable && !preview ? <Text style={styles.small}>Tap a value to change it. Formulas stay read-only.</Text> : null}
      <BottomSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.address}` : "Edit"}
        subtitle={editing ? editing.column.name : undefined}
        footer={
          <PrimaryButton
            label="Save"
            onPress={() => {
              const cell = editing;
              setEditing(null);
              if (cell && draft !== cell.raw) void onSetCell(cell, draft);
            }}
          />
        }
      >
        <Field
          label={editing?.column.name || "Value"}
          value={draft}
          onChangeText={setDraft}
          autoFocus
          keyboardType={editing && NUMERIC.includes(editing.column.type) ? "decimal-pad" : "default"}
        />
      </BottomSheet>
    </>
  );
}

function AddRowForm({ fields, preview, onAdd, tabName }: { fields: AddRowField[]; preview: boolean; onAdd: (values: Record<string, string>) => Promise<boolean>; tabName: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const filled = Object.values(values).some((value) => value.trim() !== "");
  const set = (id: string, value: string) => setValues((current) => ({ ...current, [id]: value }));
  if (fields.length === 0) return <Text style={styles.empty}>Every column here is a formula. Pick cells with a column to type into.</Text>;
  return (
    <View style={{ gap: 10 }}>
      {fields.map((field) => {
        if (field.type === "date") {
          const value = values[field.colId];
          return (
            <DateField
              key={field.colId}
              label={field.name}
              value={value ? new Date(`${value}T00:00:00`) : null}
              onChange={(date) => set(field.colId, date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "")}
            />
          );
        }
        if (field.type === "select" || field.type === "boolean") {
          const options = field.type === "boolean" ? ["TRUE", "FALSE"] : (field.options ?? []);
          return (
            <Select
              key={field.colId}
              label={field.name}
              value={values[field.colId] ?? ""}
              onChange={(value) => set(field.colId, value)}
              options={options.map((option) => ({ value: option, label: field.type === "boolean" ? (option === "TRUE" ? "Yes" : "No") : option }))}
            />
          );
        }
        return (
          <Field
            key={field.colId}
            label={field.name}
            value={values[field.colId] ?? ""}
            onChangeText={(text) => set(field.colId, text)}
            keyboardType={NUMERIC.includes(field.type) ? "decimal-pad" : "default"}
            autoCapitalize="sentences"
          />
        );
      })}
      <Button
        label={`Add row to ${tabName}`}
        icon={<Plus size={16} color={colors.primaryForeground} />}
        disabled={preview || !filled}
        loading={saving}
        stretch
        onPress={async () => {
          setSaving(true);
          const ok = await onAdd(values);
          setSaving(false);
          if (ok) setValues({});
        }}
      />
    </View>
  );
}

function DocCard({ pick, doc, preview }: { pick: DocPick; doc: Doc | undefined; preview: boolean }) {
  const write = useDocWrite();
  const content = doc?.content as DocContent | undefined;
  const page = useMemo(() => pickDocBlocks(content, pick), [content, pick]);
  const list = useMemo(() => pickDocChecks(content, pick), [content, pick]);
  if (!doc || doc.archivedAt) return <Text style={styles.empty}>This doc was deleted or archived. Pick another one on the desktop or rebuild the card.</Text>;
  const toggle = (index: number, checked: boolean) => {
    if (preview || !content) return;
    void write(doc, toggleDocCheck(content, index, checked));
  };
  const footer = <Footer label={pick.section ? `${doc.title || "Untitled doc"} · ${pick.section}` : doc.title || "Untitled doc"} id={doc.id} preview={preview} />;
  const lost = pick.section && !page.found ? <Text style={styles.note}>The heading “{pick.section}” is gone, so this shows the whole doc.</Text> : null;

  if (pick.view === "checklist") {
    const checks = list.checks;
    const done = checks.filter((item) => item.checked).length;
    const shown = pick.hideDone ? checks.filter((item) => !item.checked) : checks;
    return (
      <View style={{ gap: 8 }}>
        {lost}
        {checks.length === 0 ? (
          <Text style={styles.empty}>No checkboxes here yet.</Text>
        ) : (
          <>
            <View style={styles.meterRow}>
              <View style={{ flex: 1 }}>
                <Meter value={done / checks.length} color={colors.success} />
              </View>
              <Text style={styles.small}>
                {done} of {checks.length}
              </Text>
            </View>
            {shown.length === 0 ? <Text style={styles.small}>Everything is ticked.</Text> : null}
            {shown.map((item) => (
              <CheckRow key={item.index} text={item.text} checked={item.checked} depth={item.depth} disabled={preview} onToggle={(checked) => toggle(item.index, checked)} />
            ))}
          </>
        )}
        {footer}
      </View>
    );
  }

  return (
    <View style={{ gap: 6 }}>
      {lost}
      {page.blocks.length === 0 ? <Text style={styles.empty}>This doc is empty.</Text> : null}
      {page.blocks.slice(0, 40).map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <Text key={index} style={[styles.heading, index > 0 && { marginTop: 6 }]}>
                {block.text}
              </Text>
            );
          case "paragraph":
            return (
              <Text key={index} style={styles.body}>
                {block.text}
              </Text>
            );
          case "bullet":
            return (
              <View key={index} style={[styles.bulletRow, { paddingLeft: block.depth * 16 }]}>
                <Text style={[styles.body, styles.marker]}>{block.marker}</Text>
                <Text style={[styles.body, { flex: 1 }]}>{block.text}</Text>
              </View>
            );
          case "check":
            return <CheckRow key={index} text={block.text} checked={block.checked} depth={block.depth} disabled={preview} onToggle={(checked) => toggle(block.index, checked)} />;
          case "quote":
            return (
              <Text key={index} style={[styles.body, styles.quote]}>
                {block.text}
              </Text>
            );
          case "code":
            return (
              <Text key={index} style={styles.code} numberOfLines={6}>
                {block.text}
              </Text>
            );
          case "divider":
            return <View key={index} style={styles.divider} />;
          case "image":
            return (
              <Text key={index} style={styles.small}>
                [Image{block.alt ? `: ${block.alt}` : ""}]
              </Text>
            );
        }
      })}
      {footer}
    </View>
  );
}

function CheckRow({ text, checked, depth, disabled, onToggle }: { text: string; checked: boolean; depth: number; disabled: boolean; onToggle: (checked: boolean) => void }) {
  return (
    <AnimatedPressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={text || "Empty item"}
      disabled={disabled}
      onPress={() => onToggle(!checked)}
      style={[styles.checkRow, { paddingLeft: depth * 18 }]}
    >
      <View style={[styles.box, checked && styles.boxOn]}>{checked ? <Check size={14} color={colors.primaryForeground} strokeWidth={3} /> : null}</View>
      <Text style={[styles.checkText, checked && styles.checkDone]}>{text || "Empty item"}</Text>
    </AnimatedPressable>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  small: { color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  note: { color: colors.mutedForeground, fontSize: 12, backgroundColor: colors.muted, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  empty: { color: colors.mutedForeground, fontSize: 13, textAlign: "center", paddingVertical: 16 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  open: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  numberRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  numberMark: { width: 4, height: 30, borderRadius: 2 },
  number: { flex: 1, color: colors.foreground, fontSize: 36, fontWeight: "600", lineHeight: 40, fontVariant: ["tabular-nums"] },
  counterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  counterValue: { flex: 1, textAlign: "center", color: colors.foreground, fontSize: 36, fontWeight: "600", fontVariant: ["tabular-nums"] },
  progressHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  percent: { color: colors.foreground, fontSize: 28, fontWeight: "600", fontVariant: ["tabular-nums"] },
  barLabel: { color: colors.foreground, fontSize: 13 },
  groupRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  groupBar: { height: 7, borderRadius: 4, minWidth: 3 },
  groupValue: { width: 84, textAlign: "right", color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: "hidden" },
  tableRow: { flexDirection: "row" },
  tableHead: { backgroundColor: colors.muted },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  headCell: { paddingHorizontal: 10, paddingVertical: 8, color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  cellBox: { paddingHorizontal: 10, minHeight: 40, justifyContent: "center" },
  editable: { backgroundColor: colors.card },
  cell: { color: colors.foreground, fontSize: 13, fontVariant: ["tabular-nums"] },
  mutedCell: { color: colors.mutedForeground },
  right: { textAlign: "right" },
  meterRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.mutedForeground, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { flex: 1, color: colors.foreground, fontSize: 15 },
  checkDone: { color: colors.mutedForeground, textDecorationLine: "line-through" },
  heading: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  body: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
  bulletRow: { flexDirection: "row", gap: 8 },
  marker: { width: 14, color: colors.mutedForeground },
  quote: { borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: 10, color: colors.mutedForeground },
  code: { color: colors.foreground, fontSize: 12, fontFamily: "monospace", backgroundColor: colors.muted, borderRadius: 8, padding: 8 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
}));
