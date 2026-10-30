import { createContext, Fragment, useContext, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { ChevronRight, Sparkles } from "lucide-react-native";
import type { ComponentRenderProps, ComponentRenderer } from "@openuidev/react-lang";
import { checklistItems, findChecklistItem } from "@timely/contract/docChecklist";
import { chartNumber, genuiColorHex, genuiNodes, type GenuiName, type GenuiProps } from "@timely/contract/genui";
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import {
  useDocQuery,
  useDocsQuery,
  useSaveTask,
  useSetChecklistItem,
  useTaskQuery,
  useTasksQuery,
} from "../../lib/hooks";
import { useToastStore } from "../../lib/toast";
import AnimatedPressable from "../ui/AnimatedPressable";
import { Fill, StatNumber, StrikeTitle, TaskCheck } from "../ui/motionKit";

/*
 * The phone kit behind reply cards (assistant) and described cards
 * (dashboard): the shared OpenUI components of packages/contract/src/genui.ts
 * drawn with the phone's parts, the twin of the web's app/_components/genui/
 * kit.tsx. Cards stack and row details sit under the title. In chat cards
 * have their own border; on the dashboard the board card is the frame, so
 * sections sit flat inside it.
 */

export type KitProps<N extends GenuiName> = ComponentRenderProps<GenuiProps<N>>;

/** Opens a Timely link the way the assistant opens links in its text. */
export const Link = createContext<((href: string) => void) | undefined>(undefined);
/** Sends text as the person's next chat message; unset outside chat or while it can't take one. */
export const Ask = createContext<((text: string) => void) | undefined>(undefined);
/** Where a component sits: straight under the chat text or on a board card, inside a card, or as a card in Columns. */
export const Place = createContext<"top" | "card" | "column">("top");
/** Chat draws cards with their own border; a board card is already one. */
export const Surface = createContext<"chat" | "board">("chat");
/** The card has timed rows, so every row keeps the time column for alignment. */
const Timed = createContext(false);

const TIMED = new Set(["TaskRow", "EventRow", "FreeRow"]);

function clock(value: string | undefined) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A standalone block: its own bordered card in chat, flat on a board card. */
function Framed({ children }: { children: ReactNode }) {
  const place = useContext(Place);
  const surface = useContext(Surface);
  return place === "top" && surface === "chat" ? <View style={styles.card}>{children}</View> : <>{children}</>;
}

/** Rows divided by hairlines, sharing a time column when any of them has a time. */
export function RowGroup({ rows, renderNode }: { rows: unknown; renderNode: (node: unknown) => ReactNode }) {
  const nodes = genuiNodes(rows);
  const timed = nodes.some((row) => TIMED.has(row.typeName) && row.props.time);
  return (
    <Place.Provider value="card">
      <Timed.Provider value={timed}>
        {nodes.map((row, index) => (
          <View key={index} style={index > 0 ? styles.divider : undefined}>
            {renderNode(row)}
          </View>
        ))}
      </Timed.Provider>
    </Place.Provider>
  );
}

function Row({
  time,
  lead,
  meta,
  tone = "default",
  children,
  style,
}: {
  time?: string;
  lead?: ReactNode;
  meta?: ReactNode;
  tone?: "default" | "warning" | "success";
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const timed = useContext(Timed);
  const metaColor = tone === "warning" ? colors.warning : tone === "success" ? colors.success : colors.mutedForeground;
  return (
    <View style={[styles.row, tone === "warning" && { backgroundColor: `${colors.warning}17` }, style]}>
      {timed || time ? (
        <Text numberOfLines={1} style={styles.time}>
          {time ?? ""}
        </Text>
      ) : null}
      {lead !== undefined ? <View style={styles.lead}>{lead}</View> : null}
      <View style={styles.body}>
        {children}
        {typeof meta === "string" ? (
          <Text numberOfLines={1} style={[styles.meta, { color: metaColor }]}>
            {meta}
          </Text>
        ) : (
          meta
        )}
      </View>
    </View>
  );
}

function Card({ props, renderNode }: KitProps<"Card">) {
  const place = useContext(Place);
  const surface = useContext(Surface);
  return (
    <View style={surface === "chat" ? styles.card : undefined} accessibilityLabel={props.title}>
      <View style={styles.head}>
        <Text numberOfLines={1} style={[place === "column" ? styles.title : styles.eyebrow, styles.headTitle]}>
          {place === "column" ? props.title : props.title.toUpperCase()}
        </Text>
        {props.meta ? (
          <Text numberOfLines={1} style={styles.headMeta}>
            {props.meta}
          </Text>
        ) : null}
      </View>
      <RowGroup rows={props.rows} renderNode={renderNode} />
      {props.open ? <View style={styles.foot}>{renderNode(props.open)}</View> : null}
    </View>
  );
}

function Columns({ props, renderNode }: KitProps<"Columns">) {
  const board = useContext(Surface) === "board";
  return (
    <Place.Provider value="column">
      <View style={board ? undefined : styles.stack}>
        {genuiNodes(props.cards).map((card, index) => (
          <View key={index} style={board && index > 0 ? styles.divider : undefined}>
            {renderNode(card)}
          </View>
        ))}
      </View>
    </Place.Provider>
  );
}

function Stats({ props, renderNode }: KitProps<"Stats">) {
  const items = genuiNodes(props.items);
  if (!items.length) return null;
  // Rows stay full: two by two for four, otherwise one row.
  const columns = items.length === 4 ? 2 : Math.min(items.length, 3);
  const grid = (
    <View style={styles.statGrid}>
      {items.map((item, index) => (
        <View
          key={index}
          style={[
            { width: `${100 / columns}%` },
            index % columns > 0 && styles.statLeft,
            index >= columns && styles.statTop,
          ]}
        >
          {renderNode(item)}
        </View>
      ))}
    </View>
  );
  return <Framed>{grid}</Framed>;
}

function Stat({ props }: KitProps<"Stat">) {
  // "18/22" reads as 18 out of 22: the total sits small and muted.
  const [main, ...rest] = props.value.split("/");
  const total = rest.join("/");
  return (
    <View style={styles.stat}>
      <View style={styles.statValueRow}>
        <StatNumber value={main} numberOfLines={1} style={styles.statValue} />
        {total ? <Text style={styles.statTotal}>/{total}</Text> : null}
      </View>
      <Text numberOfLines={1} style={styles.statLabel}>
        {props.label}
      </Text>
      {props.hint ? <Text style={styles.statHint}>{props.hint}</Text> : null}
    </View>
  );
}

/** The task as it is now: from the task list, or fetched on its own (a Reminder). */
function useLiveTask(id: string) {
  const list = useTasksQuery();
  const listed = list.data?.find((task) => task.id === id);
  const single = useTaskQuery(list.isSuccess && !listed ? id : undefined);
  return listed ?? single.data;
}

function TaskRow({ props }: KitProps<"TaskRow">) {
  const task = useLiveTask(props.taskId);
  const save = useSaveTask();
  const link = useContext(Link);
  const title = task?.name || props.title;
  const done = Boolean(task?.completedAt);
  const late = task ? isOverdue(task, todayInZone()) : false;
  const toggle = () => {
    if (!task) return;
    save.mutate(
      {
        id: task.id,
        data: { completedAt: done ? "" : new Date().toISOString() },
      },
      {
        onError: (error) =>
          useToastStore.getState().show(error instanceof Error ? error.message : "Could not update the task"),
      },
    );
  };
  return (
    <Row
      time={props.time}
      tone={late ? "warning" : "default"}
      meta={done ? "Done" : props.note}
      lead={
        <TaskCheck
          checked={done}
          onToggle={toggle}
          disabled={!task}
          size={20}
          label={done ? `Reopen ${title}` : `Complete ${title}`}
        />
      }
    >
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${title}`}
        disabled={!task || !link}
        onPress={() => link?.(`timely://task/${encodeURIComponent(props.taskId)}`)}
      >
        <StrikeTitle done={done} numberOfLines={1} style={styles.rowTitle}>
          {title}
        </StrikeTitle>
      </AnimatedPressable>
    </Row>
  );
}

/** The doc as it is now: from the docs list, or fetched on its own. */
function useLiveDoc(id: string) {
  const list = useDocsQuery();
  const listed = list.data?.find((doc) => doc.id === id);
  const single = useDocQuery(list.isSuccess && !listed ? id : "");
  return listed ?? single.data;
}

/** A doc's checklist item: the tick ticks it in the doc, the words open the doc. */
function CheckRow({ props }: KitProps<"CheckRow">) {
  const doc = useLiveDoc(props.docId);
  const tick = useSetChecklistItem();
  const link = useContext(Link);
  const items = useMemo(() => checklistItems(doc?.content), [doc?.content]);
  const item = findChecklistItem(items, props.text, props.item);
  const text = item?.text ?? props.text;
  const done = Boolean(item?.done);
  const toggle = () => {
    if (!item) return;
    tick.mutate(
      { id: props.docId, item: item.item, text: item.text, done: !done },
      {
        onError: (error) =>
          useToastStore.getState().show(error instanceof Error ? error.message : "Could not tick the item"),
      },
    );
  };
  return (
    <Row
      meta={props.note}
      lead={
        <TaskCheck
          checked={done}
          onToggle={toggle}
          disabled={!item}
          size={20}
          label={done ? `Untick ${text}` : `Tick ${text}`}
        />
      }
    >
      <AnimatedPressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${doc?.title || "the doc"}`}
        disabled={!link}
        onPress={() => link?.(`timely://doc/${encodeURIComponent(props.docId)}`)}
      >
        <StrikeTitle done={done} numberOfLines={1} style={styles.rowTitle}>
          {text}
        </StrikeTitle>
      </AnimatedPressable>
    </Row>
  );
}

function EventRow({ props }: KitProps<"EventRow">) {
  return (
    <Row
      time={props.time}
      meta={props.length}
      lead={<View style={[styles.eventBar, { backgroundColor: genuiColorHex(props.color) ?? colors.primary }]} />}
    >
      <Text numberOfLines={1} style={styles.rowTitle}>
        {props.title}
      </Text>
    </Row>
  );
}

function FreeRow({ props }: KitProps<"FreeRow">) {
  const ask = useContext(Ask);
  return (
    <Row
      time={props.from}
      lead={null}
      style={styles.free}
      meta={
        ask ? (
          <AnimatedPressable
            accessibilityRole="button"
            onPress={() => ask(`Plan something for ${props.from}–${props.to}`)}
            hitSlop={8}
            style={styles.plan}
          >
            <Sparkles size={13} color={colors.primary} />
            <Text style={styles.planText}>Plan something</Text>
          </AnimatedPressable>
        ) : null
      }
    >
      <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.mutedForeground }]}>
        Free until {props.to}
      </Text>
    </Row>
  );
}

function InfoRow({ props }: KitProps<"InfoRow">) {
  const tone = props.tone ?? "default";
  const color = tone === "warning" ? colors.warning : tone === "success" ? colors.success : colors.mutedForeground;
  return (
    <Row tone={tone}>
      <View style={styles.infoLine}>
        <Text numberOfLines={1} style={[styles.rowTitle, styles.infoLabel]}>
          {props.label}
        </Text>
        {props.value ? (
          <Text numberOfLines={1} style={[styles.infoValue, { color }]}>
            {props.value}
          </Text>
        ) : null}
      </View>
      {props.note ? (
        <Text numberOfLines={1} style={styles.meta}>
          {props.note}
        </Text>
      ) : null}
    </Row>
  );
}

function ShareRow({ props }: KitProps<"ShareRow">) {
  const hex = genuiColorHex(props.color) ?? colors.primary;
  // One line in a reply; on a board card the bar runs under the label.
  if (useContext(Surface) === "chat")
    return (
      <View style={[styles.share, styles.infoLine]}>
        <View style={[styles.dot, { backgroundColor: hex }]} />
        <Text numberOfLines={1} style={[styles.rowTitle, styles.infoLabel]}>
          {props.label}
        </Text>
        <Fill value={props.share / 100} color={hex} height={6} style={styles.shareInline} />
        <Text numberOfLines={1} style={styles.infoValue}>
          {props.value}
        </Text>
      </View>
    );
  return (
    <View style={styles.share}>
      <View style={styles.infoLine}>
        <View style={[styles.dot, { backgroundColor: hex }]} />
        <Text numberOfLines={1} style={[styles.rowTitle, styles.infoLabel]}>
          {props.label}
        </Text>
        <Text numberOfLines={1} style={styles.infoValue}>
          {props.value}
        </Text>
      </View>
      <Fill value={props.share / 100} color={hex} height={6} style={styles.shareBar} />
    </View>
  );
}

function BarChart({ props }: KitProps<"BarChart">) {
  const values = (Array.isArray(props.values) ? props.values : []).slice(0, 12);
  const labels = Array.isArray(props.labels) ? props.labels : [];
  const max = Math.max(...values, 0) || 1;
  const unit = props.unit ? ` ${props.unit}` : "";
  if (!values.length) return null;
  return (
    <Framed>
      <View style={styles.chart}>
        <Text style={styles.chartTitle}>{props.title}</Text>
        <View style={styles.bars}>
          {values.map((value, index) => {
            const label = labels[index] ?? "";
            const high = props.highlight ? label === props.highlight : value === max;
            return (
              <View key={index} accessible accessibilityLabel={`${label}: ${value}${unit}`} style={styles.barColumn}>
                <Text style={styles.barText}>{chartNumber(value)}</Text>
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(2, (value / max) * 64),
                      backgroundColor: high ? colors.primary : colors.muted,
                    },
                  ]}
                />
                <Text numberOfLines={1} style={[styles.barText, styles.barLabel]}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </Framed>
  );
}

function DayStrip({ props }: KitProps<"DayStrip">) {
  const [width, setWidth] = useState(0);
  const from = clock(props.start);
  const to = clock(props.end);
  if (!(to > from)) return null;
  const span = to - from;
  const x = (minutes: number) => ((minutes - from) / span) * width;
  const slots = genuiNodes(props.slots).map((node) => node.props as GenuiProps<"Slot">);
  const ticks: number[] = [];
  for (let tick = Math.ceil(from / 120) * 120; tick <= to; tick += 120) ticks.push(tick);
  const summary = slots
    .map((slot) => `${slot.from}–${slot.to} ${slot.kind === "free" ? "free" : (slot.label ?? slot.kind)}`)
    .join(", ");
  const strip = (
    <View style={styles.stripWrap}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={styles.strip}
      >
        {width
          ? slots.map((slot, index) => {
              const start = Math.max(clock(slot.from), from);
              const end = Math.min(clock(slot.to), to);
              if (!(end > start)) return null;
              const free = slot.kind === "free";
              const hex = genuiColorHex(slot.color);
              const plain = slot.kind === "task" && !hex;
              const size = x(end) - x(start) - 3;
              const label = free ? (slot.label ?? "Free") : slot.label;
              return (
                <View
                  key={index}
                  style={[
                    styles.slot,
                    { left: x(start), width: Math.max(size, 2) },
                    free
                      ? styles.slotFree
                      : {
                          backgroundColor: plain ? colors.primary : (hex ?? genuiColorHex("indigo")),
                        },
                  ]}
                >
                  {/* A label shows only where it fits. */}
                  {label && size >= 40 ? (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.slotText,
                        {
                          color: free ? colors.mutedForeground : plain ? colors.primaryForeground : "#fff",
                        },
                      ]}
                    >
                      {label}
                    </Text>
                  ) : null}
                </View>
              );
            })
          : null}
      </View>
      <View style={styles.ticks}>
        {width
          ? ticks.map((tick, index) => {
              const left = x(tick);
              const edge = index === 0 && left < 10 ? "start" : left > width - 10 ? "end" : "middle";
              return (
                <Text
                  key={tick}
                  style={[
                    styles.tick,
                    {
                      left: edge === "start" ? 0 : edge === "end" ? width - 20 : left - 10,
                      textAlign: edge === "start" ? "left" : edge === "end" ? "right" : "center",
                    },
                  ]}
                >
                  {pad(Math.floor(tick / 60))}
                </Text>
              );
            })
          : null}
      </View>
    </View>
  );
  return <Framed>{strip}</Framed>;
}

function TextBlock({ props }: KitProps<"Text">) {
  return <Text style={styles.text}>{props.text}</Text>;
}

const SCREENS = {
  today: "/today",
  calendar: "/calendar",
  tasks: "/tasks",
  inbox: "/inbox",
  dashboard: "/dashboard",
} as const;

function Open({ props }: KitProps<"Open">) {
  const link = useContext(Link);
  const { target, id } = props;
  const href =
    target in SCREENS
      ? SCREENS[target as keyof typeof SCREENS]
      : id
        ? `timely://${target}/${encodeURIComponent(id)}`
        : null;
  if (!href || !link) return null;
  return (
    <AnimatedPressable accessibilityRole="link" onPress={() => link(href)} hitSlop={6} style={styles.open}>
      <Text style={styles.openText}>{props.label}</Text>
      <ChevronRight size={14} color={colors.primary} />
    </AnimatedPressable>
  );
}

// Slots are drawn by their DayStrip, which reads their props.
const Slot = () => null;

type KitName = Exclude<GenuiName, "Reply" | "Choices">;

/** Renderers for every shared component; chat adds Reply and Choices, the dashboard Panel and List. */
export const kit: { [N in KitName]: ComponentRenderer<GenuiProps<N>> } = {
  Card,
  Columns,
  Stats,
  Stat,
  TaskRow,
  CheckRow,
  EventRow,
  FreeRow,
  InfoRow,
  ShareRow,
  BarChart,
  DayStrip,
  Slot,
  Text: TextBlock,
  Open,
};

const styles = createThemedStyleSheet((colors) => ({
  stack: { gap: 10 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 7,
  },
  headTitle: { flexShrink: 1 },
  eyebrow: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
  },
  title: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  headMeta: {
    marginLeft: "auto",
    flexShrink: 4,
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: "500",
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  foot: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  time: {
    // Fits "10:00" and the board's "26 Oct" on one line.
    width: 48,
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  lead: {
    width: 20,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.foreground, fontSize: 15 },
  meta: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
    marginTop: 1,
  },
  eventBar: { width: 3, flex: 1, marginVertical: 9, borderRadius: 2 },
  free: { backgroundColor: `${colors.mutedForeground}10` },
  plan: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  planText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  infoLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoLabel: { flex: 1, minWidth: 0 },
  infoValue: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  share: { paddingHorizontal: 14, paddingVertical: 11, gap: 8 },
  shareBar: { marginLeft: 18 },
  shareInline: { width: 64 },
  statGrid: { flexDirection: "row", flexWrap: "wrap" },
  statLeft: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  statTop: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  stat: { paddingHorizontal: 14, paddingVertical: 12 },
  statValueRow: { flexDirection: "row", alignItems: "baseline" },
  statValue: {
    color: colors.foreground,
    fontSize: 20,
    fontWeight: "600",
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
  },
  statTotal: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  statLabel: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  statHint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  chart: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12 },
  chartTitle: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "500",
    marginBottom: 4,
  },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 8, height: 108 },
  barColumn: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 5,
  },
  bar: {
    width: "100%",
    maxWidth: 30,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  barText: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  barLabel: { fontWeight: "500" },
  stripWrap: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  strip: {
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  slot: {
    position: "absolute",
    top: 5,
    bottom: 5,
    borderRadius: 5,
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  slotFree: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.input,
    backgroundColor: colors.card,
  },
  slotText: { fontSize: 11, fontWeight: "600" },
  ticks: { height: 16, marginTop: 4 },
  tick: {
    position: "absolute",
    top: 0,
    width: 20,
    color: colors.mutedForeground,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  text: {
    color: colors.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  open: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    alignSelf: "flex-start",
  },
  openText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
}));
