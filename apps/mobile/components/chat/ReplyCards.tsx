// Before @openuidev/react-lang, which reads its devtools flag as it loads.
import "./genuiSetup";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { CalendarDays, ChevronRight, Sparkles } from "lucide-react-native";
import {
  createLibrary,
  Renderer,
  useRenderNode,
  type ComponentRenderProps,
  type ComponentRenderer,
} from "@openuidev/react-lang";
import {
  GENUI_ROOT,
  genuiColorHex,
  genuiNodes,
  isBoardBlock,
  splitReply,
  spokenTime,
  withRenderers,
  type GenuiName,
  type GenuiNode,
  type GenuiProps,
} from "@timely/contract/genui";
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { useSaveTask, useTaskQuery, useTasksQuery } from "../../lib/hooks";
import { useToastStore } from "../../lib/toast";
import AnimatedPressable from "../ui/AnimatedPressable";
import { Fill, StatNumber, StrikeTitle, TaskCheck } from "../ui/motionKit";
import { PropertyChip } from "../ui/primitives";
import DateTimeSheet from "../ui/DateTimeSheet";
import { ChatText } from "./shared";

/*
 * Reply cards on the phone: the agent's ```openui-lang programs
 * (packages/contract/src/genui.ts) drawn with the phone kit, the twin of the
 * web's app/_components/chat/replyCards.tsx. Cards stack, row details sit
 * under the title, and a reply with a board (a day strip, stats, a chart)
 * runs under the avatar to use the full width. A tick saves at once; answer
 * chips and "Pick a time…" send the person's reply.
 */

type Props<N extends GenuiName> = ComponentRenderProps<GenuiProps<N>>;

/** Opens a Timely link the way the assistant opens links in its text. */
const Link = createContext<((href: string) => void) | undefined>(undefined);
/** Sends text as the person's next message; unset while the chat can't take one. */
const Ask = createContext<((text: string) => void) | undefined>(undefined);
/** This is the newest reply, so its Choices still answer it. */
const Newest = createContext(false);
/** Where a component sits: straight under the text, inside a card, or as a card in Columns. */
const Place = createContext<"reply" | "card" | "column">("reply");
/** The card has timed rows, so every row keeps the time column for alignment. */
const Timed = createContext(false);

const TIMED = new Set(["TaskRow", "EventRow", "FreeRow"]);
// The avatar and gap before the reply column in Thread.
const AVATAR = 38;

function clock(value: string | undefined) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
}

const pad = (n: number) => String(n).padStart(2, "0");

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
      {timed || time ? <Text style={styles.time}>{time ?? ""}</Text> : null}
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

function Reply({ props, renderNode }: Props<"Reply">) {
  const blocks = genuiNodes(props.blocks);
  const wide = blocks.some(isBoardBlock);
  return (
    <View style={styles.reply}>
      {blocks.map((block, index) => (
        <View key={index} style={wide && block.typeName !== "Choices" ? styles.wide : undefined}>
          {renderNode(block)}
        </View>
      ))}
    </View>
  );
}

function Card({ props, renderNode }: Props<"Card">) {
  const place = useContext(Place);
  const rows = genuiNodes(props.rows);
  const timed = rows.some((row) => TIMED.has(row.typeName) && row.props.time);
  return (
    <View style={styles.card} accessibilityLabel={props.title}>
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
      <Place.Provider value="card">
        <Timed.Provider value={timed}>
          {rows.map((row, index) => (
            <View key={index} style={index > 0 ? styles.divider : undefined}>
              {renderNode(row)}
            </View>
          ))}
        </Timed.Provider>
      </Place.Provider>
      {props.open ? <View style={styles.foot}>{renderNode(props.open)}</View> : null}
    </View>
  );
}

function Columns({ props, renderNode }: Props<"Columns">) {
  return (
    <Place.Provider value="column">
      <View style={styles.stack}>
        {genuiNodes(props.cards).map((card, index) => (
          <View key={index}>{renderNode(card)}</View>
        ))}
      </View>
    </Place.Provider>
  );
}

function Stats({ props, renderNode }: Props<"Stats">) {
  const place = useContext(Place);
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
  return place === "reply" ? <View style={styles.card}>{grid}</View> : grid;
}

function Stat({ props }: Props<"Stat">) {
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

function TaskRow({ props }: Props<"TaskRow">) {
  const task = useLiveTask(props.taskId);
  const save = useSaveTask();
  const link = useContext(Link);
  const title = task?.name || props.title;
  const done = Boolean(task?.completedAt);
  const late = task ? isOverdue(task, todayInZone()) : false;
  const toggle = () => {
    if (!task) return;
    save.mutate(
      { id: task.id, data: { completedAt: done ? "" : new Date().toISOString() } },
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

function EventRow({ props }: Props<"EventRow">) {
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

function FreeRow({ props }: Props<"FreeRow">) {
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

function InfoRow({ props }: Props<"InfoRow">) {
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

function ShareRow({ props }: Props<"ShareRow">) {
  const hex = genuiColorHex(props.color) ?? colors.primary;
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

function BarChart({ props }: Props<"BarChart">) {
  const values = (Array.isArray(props.values) ? props.values : []).slice(0, 12);
  const labels = Array.isArray(props.labels) ? props.labels : [];
  const max = Math.max(...values, 0) || 1;
  const unit = props.unit ? ` ${props.unit}` : "";
  return (
    <View style={styles.chart}>
      <Text style={styles.chartTitle}>{props.title}</Text>
      <View style={styles.bars}>
        {values.map((value, index) => {
          const label = labels[index] ?? "";
          const high = props.highlight ? label === props.highlight : value === max;
          return (
            <View key={index} accessible accessibilityLabel={`${label}: ${value}${unit}`} style={styles.barColumn}>
              <Text style={styles.barText}>{value}</Text>
              <View
                style={[
                  styles.bar,
                  { height: Math.max(2, (value / max) * 64), backgroundColor: high ? colors.primary : colors.muted },
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
  );
}

function DayStrip({ props }: Props<"DayStrip">) {
  const place = useContext(Place);
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
                      : { backgroundColor: plain ? colors.primary : (hex ?? genuiColorHex("indigo")) },
                  ]}
                >
                  {/* A label shows only where it fits. */}
                  {label && size >= 40 ? (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.slotText,
                        { color: free ? colors.mutedForeground : plain ? colors.primaryForeground : "#fff" },
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
  return place === "reply" ? <View style={styles.card}>{strip}</View> : strip;
}

function TextBlock({ props }: Props<"Text">) {
  return <Text style={styles.text}>{props.text}</Text>;
}

function Choices({ props }: Props<"Choices">) {
  const ask = useContext(Ask);
  const answer = useContext(Newest) ? ask : undefined;
  const [picked, setPicked] = useState("");
  const [picking, setPicking] = useState(false);
  const send = (text: string) => {
    if (!answer || !text) return;
    setPicked(text);
    answer(text);
  };
  const options = (Array.isArray(props.options) ? props.options : []).slice(0, 4);
  return (
    <View
      accessibilityLabel="Suggested answers"
      style={[styles.choices, !answer && styles.choicesOff]}
    >
      {options.map((option) => (
        <PropertyChip key={option} label={option} active={picked === option} onPress={() => send(option)} />
      ))}
      {props.pickTime ? (
        <>
          <PropertyChip
            empty
            label="Pick a time…"
            icon={<CalendarDays size={15} color={colors.mutedForeground} />}
            onPress={() => setPicking(true)}
          />
          <DateTimeSheet
            open={picking}
            value={null}
            mode="datetime"
            clearable={false}
            onClose={() => setPicking(false)}
            onChange={(date) => date && send(spokenTime(date))}
          />
        </>
      ) : null}
    </View>
  );
}

const SCREENS = { today: "/today", calendar: "/calendar", tasks: "/tasks", inbox: "/inbox", dashboard: "/dashboard" } as const;

function Open({ props }: Props<"Open">) {
  const link = useContext(Link);
  const { target, id } = props;
  const href = target in SCREENS ? SCREENS[target as keyof typeof SCREENS] : id ? `timely://${target}/${encodeURIComponent(id)}` : null;
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

const renderers: { [N in GenuiName]: ComponentRenderer<GenuiProps<N>> } = {
  Reply,
  Card,
  Columns,
  Stats,
  Stat,
  TaskRow,
  EventRow,
  FreeRow,
  InfoRow,
  ShareRow,
  BarChart,
  DayStrip,
  Slot,
  Choices,
  Text: TextBlock,
  Open,
};

const library = createLibrary({ components: withRenderers(renderers), root: GENUI_ROOT });

function Root({ node }: { node: GenuiNode }) {
  const renderNode = useRenderNode();
  return <>{renderNode(node)}</>;
}

// The package's default Renderer draws DOM elements, so the phone renders the
// parsed root itself inside Renderer.Root (which keeps the error boundaries).
function Cards({ code }: { code: string }) {
  const [root, setRoot] = useState<GenuiNode | null | undefined>(undefined);
  return (
    <Renderer.Root
      response={code}
      library={library}
      publishObservability={false}
      onParseResult={(result) => setRoot((result?.root as GenuiNode | null | undefined) ?? null)}
    >
      {root ? <Root node={root} /> : root === null ? <Text style={styles.failed}>These cards could not be shown.</Text> : null}
    </Renderer.Root>
  );
}

/**
 * An assistant reply: its text, with any reply cards drawn where the agent put
 * them. `ask` sends a card's text (an answer chip, "Plan something") as the
 * person's next message; leave it unset while the chat can't take one. Only
 * the `newest` reply's answer chips stay live.
 */
export default function ReplyBody({
  content,
  onLink,
  ask,
  newest = false,
}: {
  content: string;
  onLink: (href: string) => void;
  ask?: (text: string) => void;
  newest?: boolean;
}) {
  const parts = useMemo(() => splitReply(content), [content]);
  return (
    <Link.Provider value={onLink}>
      <Ask.Provider value={ask}>
        <Newest.Provider value={newest}>
          {parts.map((part, index) =>
            part.kind === "text" ? (
              <ChatText key={index} text={part.text} onLink={onLink} />
            ) : (
              <Cards key={index} code={part.code} />
            ),
          )}
        </Newest.Provider>
      </Ask.Provider>
    </Link.Provider>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  reply: { gap: 10, marginTop: 2 },
  wide: { marginLeft: -AVATAR },
  stack: { gap: 10 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 7 },
  headTitle: { flexShrink: 1 },
  eyebrow: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600", letterSpacing: 0.8 },
  title: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  headMeta: { marginLeft: "auto", flexShrink: 4, color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  foot: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  row: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 6 },
  time: { width: 42, color: colors.mutedForeground, fontSize: 13, fontWeight: "500", fontVariant: ["tabular-nums"] },
  lead: { width: 20, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.foreground, fontSize: 15 },
  meta: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", lineHeight: 16, marginTop: 1 },
  eventBar: { width: 3, flex: 1, marginVertical: 9, borderRadius: 2 },
  free: { backgroundColor: `${colors.mutedForeground}10` },
  plan: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", marginTop: 2 },
  planText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  infoLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoLabel: { flex: 1, minWidth: 0 },
  infoValue: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500", fontVariant: ["tabular-nums"], flexShrink: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  share: { paddingHorizontal: 14, paddingVertical: 11, gap: 8 },
  shareBar: { marginLeft: 18 },
  statGrid: { flexDirection: "row", flexWrap: "wrap" },
  statLeft: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  statTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  stat: { paddingHorizontal: 14, paddingVertical: 12 },
  statValueRow: { flexDirection: "row", alignItems: "baseline" },
  statValue: { color: colors.foreground, fontSize: 20, fontWeight: "600", letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  statTotal: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
  statLabel: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  statHint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  chart: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12 },
  chartTitle: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginBottom: 4 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 8, height: 108 },
  barColumn: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "flex-end", gap: 5 },
  bar: { width: "100%", maxWidth: 30, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  barText: { color: colors.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] },
  barLabel: { fontWeight: "500" },
  stripWrap: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 },
  strip: { height: 32, borderRadius: 8, backgroundColor: colors.muted, overflow: "hidden" },
  slot: { position: "absolute", top: 5, bottom: 5, borderRadius: 5, justifyContent: "center", paddingHorizontal: 6 },
  slotFree: { borderWidth: 1, borderStyle: "dashed", borderColor: colors.input, backgroundColor: colors.card },
  slotText: { fontSize: 11, fontWeight: "600" },
  ticks: { height: 16, marginTop: 4 },
  tick: { position: "absolute", top: 0, width: 20, color: colors.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] },
  text: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20, paddingHorizontal: 14, paddingVertical: 10 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  choicesOff: { opacity: 0.5, pointerEvents: "none" },
  open: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  openText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  failed: { color: colors.mutedForeground, fontSize: 12 },
}));
