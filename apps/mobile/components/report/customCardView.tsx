import { Text, View } from "react-native";
import { ArrowDownRight, ArrowUpRight, CalendarDays, CheckCircle2, FileText, FolderKanban, ListTodo, Minus, Sheet as SheetIcon } from "lucide-react-native";
import { formatMetric, type CardQuery, type CardResult, type CardRow, type EntityKind } from "@timely/contract/dashboard";
import { seriesColor } from "../../lib/dashboard";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import { CategoryBars, ColumnChart, DonutChart, LineChart, Meter } from "./charts";

const ENTITY_ICON: Record<EntityKind, typeof ListTodo> = {
  task: ListTodo,
  project: FolderKanban,
  event: CalendarDays,
  doc: FileText,
  sheet: SheetIcon,
};

/** Draws a custom card's computed result: the same engine and shapes as web, laid out for a phone. */
export default function CustomCardView({ query, result, onOpen }: { query: CardQuery; result: CardResult; onOpen: (row: CardRow) => void }) {
  const color = query.color ?? 0;

  switch (result.kind) {
    case "number": {
      const delta = result.previous !== undefined ? result.value - result.previous : null;
      // "Up" is good unless the card counts something to drive down.
      const upIsGood = !(query.filters.overdue || (query.filters.state === "open" && query.source !== "events"));
      const tone = delta === null || delta === 0 ? colors.mutedForeground : delta > 0 === upIsGood ? colors.success : colors.destructive;
      const DeltaIcon = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
      return (
        <View>
          <View style={styles.numberRow}>
            <View style={[styles.numberMark, { backgroundColor: seriesColor(color) }]} />
            <Text style={styles.number}>{formatMetric(result.value, result.unit)}</Text>
          </View>
          {delta !== null ? (
            <View style={styles.deltaRow}>
              <DeltaIcon size={14} color={tone} />
              <Text style={[styles.small, { color: tone }]}>
                {delta > 0 ? "+" : ""}
                {formatMetric(delta, result.unit)}
              </Text>
              <Text style={styles.small}>{result.periodLabel}</Text>
            </View>
          ) : result.unit === "hours" ? (
            <Text style={[styles.small, { marginTop: 6 }]}>
              {result.matched} {result.matched === 1 ? "item" : "items"}
            </Text>
          ) : null}
        </View>
      );
    }
    case "progress": {
      const share = result.target > 0 ? result.value / result.target : 0;
      return (
        <View style={{ gap: 8 }}>
          <View style={styles.progressHead}>
            <Text style={styles.percent}>{Math.round(share * 100)}%</Text>
            <View style={styles.deltaRow}>
              {share >= 1 ? <CheckCircle2 size={14} color={colors.success} /> : null}
              <Text style={styles.small}>
                {formatMetric(result.value, result.unit)} of {formatMetric(result.target, result.unit)}
                {query.progress === "goal" ? " goal" : " done"}
              </Text>
            </View>
          </View>
          <Meter value={share} color={color} />
        </View>
      );
    }
    case "list":
      if (result.rows.length === 0) return <Text style={styles.empty}>Nothing matches right now.</Text>;
      return (
        <View>
          {result.rows.map((row, index) => {
            const Icon = ENTITY_ICON[row.entity];
            return (
              <AnimatedPressable
                key={`${row.entity}-${row.id}`}
                accessibilityRole="button"
                onPress={() => onOpen(row)}
                style={[styles.row, index > 0 && styles.rowDivider]}
              >
                <Icon size={15} color={colors.mutedForeground} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.rowTitle, row.done && styles.rowDone]} numberOfLines={1}>
                    {row.title}
                  </Text>
                  {row.subtitle ? (
                    <Text style={styles.small} numberOfLines={1}>
                      {row.subtitle}
                    </Text>
                  ) : null}
                </View>
                {row.meta ? <Text style={[styles.small, row.tone === "danger" && { color: colors.destructive }]}>{row.meta}</Text> : null}
              </AnimatedPressable>
            );
          })}
          {result.total > result.rows.length ? (
            <Text style={[styles.small, { marginTop: 6 }]}>
              {result.rows.length} of {result.total}
            </Text>
          ) : null}
        </View>
      );
    case "series":
      if (!result.temporal && (result.points.length === 0 || result.points.every((point) => point.value === 0))) {
        return <Text style={styles.empty}>No data for these settings yet.</Text>;
      }
      if (query.display === "pie") return <DonutChart points={result.points} unit={result.unit} total={result.total} />;
      if (query.display === "line") return <LineChart points={result.points} unit={result.unit} color={color} />;
      if (result.temporal || query.groupBy === "weekday") return <ColumnChart points={result.points} unit={result.unit} color={color} />;
      return <CategoryBars points={result.points} unit={result.unit} color={color} />;
  }
}

const styles = createThemedStyleSheet((colors) => ({
  numberRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  numberMark: { width: 4, height: 30, borderRadius: 2 },
  number: { color: colors.foreground, fontSize: 36, fontWeight: "700", lineHeight: 38, fontVariant: ["tabular-nums"] },
  deltaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  progressHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  percent: { color: colors.foreground, fontSize: 28, fontWeight: "700", fontVariant: ["tabular-nums"] },
  small: { color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  empty: { color: colors.mutedForeground, fontSize: 13, textAlign: "center", paddingVertical: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: { color: colors.foreground, fontSize: 14 },
  rowDone: { color: colors.mutedForeground, textDecorationLine: "line-through" },
}));
