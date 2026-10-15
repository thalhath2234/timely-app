import type { ReactElement } from "react";
import { cloneElement, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, ScrollView, type RefreshControlProps, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { Task, TaskListGroupField } from "../../lib/types";
import type { NamedStatusGroup } from "../../lib/status";
import { statusNameKey } from "../../lib/status";
import { PRIORITIES } from "../../lib/priority";
import { PRIORITY_META } from "../../lib/format";
import { resolvedColor } from "../../lib/entityColor";
import { GripVertical } from "lucide-react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import TaskCard from "./TaskCard";

export type KanbanColumn = {
  key: string;
  title: string;
  color: string | null;
  tasks: Task[];
};

export function kanbanColumns(tasks: Task[], statusGroups: NamedStatusGroup[], field: TaskListGroupField = "status", selectedStatusIds: string[] = [], selectedPriorityLevels: string[] = []): KanbanColumn[] {
  const selectedStatuses = selectedStatusIds.length ? statusGroups.filter((group) => group.statuses.some((status) => selectedStatusIds.includes(status.id))) : statusGroups;
  const columns: KanbanColumn[] = field === "status" ? selectedStatuses.map((group) => ({
    key: group.key,
    title: group.name,
    color: group.color,
    tasks: [],
  })) : field === "priority" ? (selectedPriorityLevels.length ? PRIORITIES.filter((level) => selectedPriorityLevels.includes(level)) : PRIORITIES).map((level) => ({ key: level, title: level, color: PRIORITY_META[level]?.color ?? null, tasks: [] })) : [];
  const noneTitle = { priority: "No priority", status: "No status", workspace: "No workspace", project: "No project", stage: "No stage" }[field as string] ?? "No value";
  const none: KanbanColumn = { key: "none", title: noneTitle, color: null, tasks: [] };
  if (field !== "status" && field !== "priority") {
    for (const task of tasks) {
      const id = field === "workspace" ? task.workspaceId : field === "project" ? task.projectId : field === "stage" ? task.stageId : null;
      const stage = field === "stage" ? task.stage ?? task.project?.stages?.find((item) => item.id === id) : null;
      const title = field === "workspace" ? task.workspace?.name : field === "project" ? task.project?.title : stage?.name;
      if (!id) { none.tasks.push(task); continue; }
      let column = columns.find((item) => item.key === id);
      if (!column) {
        // Same colours as the desktop board: the entity's own, else its auto colour.
        const own = field === "workspace" ? task.workspace?.color : field === "project" ? task.project?.color : stage?.color;
        column = { key: id, title: title || "Untitled", color: resolvedColor(own, id), tasks: [] };
        columns.push(column);
      }
      column.tasks.push(task);
    }
    return none.tasks.length ? [...columns, none] : columns;
  }
  const byKey = new Map(columns.map((column) => [column.key, column]));

  for (const task of tasks) {
    const key = field === "priority" ? task.priorityLevel || "none" : statusNameKey(task.status?.name) || "none";
    const column = byKey.get(key);
    if (column) column.tasks.push(task);
    else none.tasks.push(task);
  }

  return none.tasks.length > 0 ? [...columns, none] : columns.length > 0 ? columns : [none];
}

// Board geometry, shared by the styles and the drop-target maths below.
const COLUMN_WIDTH = 272;
const COLUMN_GAP = 10;
const BOARD_PADDING = 12;
/** How close to the board's left/right edge the finger must be to scroll it while dragging. */
const EDGE_ZONE = 64;
const MAX_EDGE_SPEED = 16;

type DragState = { task: Task; from: string; width: number };

type DragApi = {
  begin: (task: Task, from: string, card: View | null, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: (dropped: boolean) => void;
};

type DragOffset = { x: SharedValue<number>; y: SharedValue<number> };

function DragGrip({ task, from, card, api, offset }: { task: Task; from: string; card: React.RefObject<View | null>; api: React.RefObject<DragApi>; offset: DragOffset }) {
  // Read through a ref so a refetch mid-drag doesn't swap the gesture (which would cancel it).
  const current = useRef({ task, from });
  current.current = { task, from };
  const pan = useMemo(() => {
    const begin = (x: number, y: number) => api.current.begin(current.current.task, current.current.from, card.current, x, y);
    const move = (x: number, y: number) => api.current.move(x, y);
    const end = (dropped: boolean) => api.current.end(dropped);
    const { x: dragX, y: dragY } = offset;
    // Starts on the first movement: the grip is the explicit affordance, so no long press.
    return Gesture.Pan()
      .minDistance(1)
      .onStart((event) => {
        "worklet";
        dragX.value = 0;
        dragY.value = 0;
        scheduleOnRN(begin, event.absoluteX, event.absoluteY);
      })
      .onUpdate((event) => {
        "worklet";
        // The floating card follows the finger on the UI thread; the column maths runs in JS.
        dragX.value = event.translationX;
        dragY.value = event.translationY;
        scheduleOnRN(move, event.absoluteX, event.absoluteY);
      })
      .onEnd((_event, success) => {
        "worklet";
        scheduleOnRN(end, success);
      })
      .onFinalize(() => {
        "worklet";
        // A no-op after onEnd; cleans up when the system cancels the touch.
        scheduleOnRN(end, false);
      });
  }, [api, card, offset]);
  return (
    <GestureDetector gesture={pan}>
      <View accessible accessibilityRole="button" accessibilityLabel={`Drag ${task.name}`} accessibilityHint="Drag to another column" style={styles.grip}>
        <GripVertical size={18} color={colors.mutedForeground} />
      </View>
    </GestureDetector>
  );
}

function BoardCard({ task, column, dragging, api, offset, ...props }: { task: Task; column: string; dragging: boolean; api: React.RefObject<DragApi>; offset: DragOffset; hideStatus: boolean; today: string; selected: boolean; selecting: boolean; onSelect: (task: Task) => void; onToggle: (task: Task) => void }) {
  const ref = useRef<View>(null);
  return (
    <View ref={ref} collapsable={false} style={[styles.cardWrap, dragging && styles.placeholder]}>
      <TaskCard task={task} {...props} trailing={<DragGrip task={task} from={column} card={ref} api={api} offset={offset} />} />
    </View>
  );
}

export default function MobileKanban({
  columns,
  today,
  selectedIds,
  selecting,
  onSelect,
  onToggle,
  onMove,
  refreshControl,
  hideStatus = false,
}: {
  columns: KanbanColumn[];
  /** True when the columns are statuses, so cards drop their own status chip. */
  hideStatus?: boolean;
  /** Today's date in the Working hours zone (`todayInZone`). */
  today: string;
  selectedIds: string[];
  selecting: boolean;
  onSelect: (task: Task) => void;
  onToggle: (task: Task) => void;
  /** Called only when a card lands in a different column. */
  onMove: (task: Task, column: KanbanColumn) => void;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const offset = useMemo(() => ({ x, y }), [x, y]);
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  const lift = useSharedValue(0);
  const root = useRef<View>(null);
  const scroller = useRef<ScrollView>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Mutable drag bookkeeping read by the gesture callbacks and the edge-scroll loop.
  const live = useRef({
    active: false,
    // False until the board and card are measured; the column maths needs both.
    ready: false,
    task: null as Task | null,
    from: "",
    hover: null as string | null,
    rootX: 0,
    rootY: 0,
    rootW: 0,
    rootH: 0,
    fingerX: 0,
    fingerY: 0,
    scrollX: 0,
    contentW: 0,
    maxScroll: 0,
    frame: 0 as number,
    settle: null as ReturnType<typeof setTimeout> | null,
  }).current;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const floating = useAnimatedStyle(() => ({
    opacity: lift.value === 0 ? 0 : 1,
    transform: [
      { translateX: baseX.value + x.value },
      { translateY: baseY.value + y.value },
      { scale: 1 + 0.03 * lift.value },
      { rotate: `${-2 * lift.value}deg` },
    ],
  }));

  const api = useRef<DragApi>(null as unknown as DragApi);
  api.current = useMemo<DragApi>(() => {
    const columnAt = (fingerX: number, fingerY: number) => {
      const list = columnsRef.current;
      const insideY = fingerY >= live.rootY - 24 && fingerY <= live.rootY + live.rootH + 24;
      if (!list.length || !insideY) return null;
      const contentX = fingerX - live.rootX + live.scrollX - BOARD_PADDING + COLUMN_GAP / 2;
      const index = Math.max(0, Math.min(list.length - 1, Math.floor(contentX / (COLUMN_WIDTH + COLUMN_GAP))));
      return list[index].key;
    };
    const track = () => {
      const key = columnAt(live.fingerX, live.fingerY);
      if (key !== live.hover) {
        live.hover = key;
        setHover(key);
      }
    };
    const edgeSpeed = () => {
      const local = live.fingerX - live.rootX;
      if (local < EDGE_ZONE) return -MAX_EDGE_SPEED * Math.min(1, (EDGE_ZONE - local) / EDGE_ZONE);
      if (local > live.rootW - EDGE_ZONE) return MAX_EDGE_SPEED * Math.min(1, (local - (live.rootW - EDGE_ZONE)) / EDGE_ZONE);
      return 0;
    };
    const tick = () => {
      live.frame = 0;
      if (!live.active || !live.ready) return;
      const speed = edgeSpeed();
      const next = Math.max(0, Math.min(live.maxScroll, live.scrollX + speed));
      if (speed !== 0 && next !== live.scrollX) {
        live.scrollX = next;
        scroller.current?.scrollTo({ x: next, animated: false });
        track();
      }
      if (speed !== 0) live.frame = requestAnimationFrame(tick);
    };
    const finish = () => {
      if (live.settle) clearTimeout(live.settle);
      live.settle = null;
      live.active = false;
      live.ready = false;
      live.task = null;
      live.hover = null;
      lift.value = 0;
      setDrag(null);
      setHover(null);
    };
    return {
      begin: (task, from, card, fingerX, fingerY) => {
        if (live.active) return;
        if (live.settle) finish();
        live.active = true;
        live.task = task;
        live.from = from;
        live.fingerX = fingerX;
        live.fingerY = fingerY;
        root.current?.measureInWindow((rx, ry, rw, rh) => {
          live.rootX = rx;
          live.rootY = ry;
          live.rootW = rw;
          live.rootH = rh;
          live.maxScroll = Math.max(0, live.contentW - rw);
          card?.measureInWindow((cx, cy, cw) => {
            if (!live.active || live.task?.id !== task.id) return;
            live.ready = true;
            baseX.value = cx - rx;
            baseY.value = cy - ry;
            lift.value = withTiming(1, { duration: 120 });
            setDrag({ task, from, width: cw });
            track();
          });
        });
      },
      move: (fingerX, fingerY) => {
        if (!live.active) return;
        live.fingerX = fingerX;
        live.fingerY = fingerY;
        if (!live.ready) return;
        track();
        if (!live.frame && edgeSpeed() !== 0) live.frame = requestAnimationFrame(tick);
      },
      end: (dropped) => {
        if (!live.active) return;
        if (live.frame) cancelAnimationFrame(live.frame);
        live.frame = 0;
        const task = live.task;
        const target = dropped ? columnsRef.current.find((column) => column.key === live.hover) : undefined;
        live.active = false;
        if (task && target && target.key !== live.from) {
          // The card reappears in its new column straight away (optimistic save).
          finish();
          onMoveRef.current(task, target);
          return;
        }
        // Same column, off the board or cancelled: glide back to where it was picked up.
        x.value = withTiming(0, { duration: 180 });
        y.value = withTiming(0, { duration: 180 });
        lift.value = withTiming(0.0001, { duration: 180 });
        setHover(null);
        live.settle = setTimeout(finish, 190);
      },
    };
  }, [baseX, baseY, lift, live, x, y]);

  useEffect(() => () => {
    if (live.frame) cancelAnimationFrame(live.frame);
    if (live.settle) clearTimeout(live.settle);
  }, [live]);

  const dragId = drag?.task.id ?? null;
  return (
    <View ref={root} collapsable={false} style={styles.scroller}>
      <ScrollView
        ref={scroller}
        keyboardShouldPersistTaps="handled"
        horizontal
        nestedScrollEnabled
        // Not toggled while dragging: on web that resets the scroll to 0, and
        // the active grip gesture already cancels the scrollers' own touches.
        style={styles.scroller}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.board}
        scrollEventThrottle={16}
        onScroll={(event) => { live.scrollX = event.nativeEvent.contentOffset.x; }}
        onContentSizeChange={(width) => { live.contentW = width; }}
      >
        {columns.map((column) => {
          const target = drag !== null && hover === column.key && column.key !== drag.from;
          return (
            <View key={column.key} style={[styles.column, target && styles.columnTarget]}>
              <View style={styles.head}>
                <View style={[styles.dot, { backgroundColor: column.color ?? colors.mutedForeground }]} />
                <Text style={styles.title} numberOfLines={1}>
                  {column.title}
                </Text>
                <Text style={styles.count}>{column.tasks.length}</Text>
              </View>
              <FlatList
                data={column.tasks}
                extraData={`${dragId}:${selectedIds.join(",")}:${selecting}`}
                keyExtractor={(item) => item.id}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                style={styles.list}
                contentContainerStyle={styles.cards}
                initialNumToRender={8}
                windowSize={5}
                refreshControl={refreshControl ? cloneElement(refreshControl, { key: column.key, enabled: !drag }) : undefined}
                ListHeaderComponent={target ? (
                  <View style={styles.slot}>
                    <Text style={styles.slotText} numberOfLines={1}>Move to {column.title}</Text>
                  </View>
                ) : null}
                ListEmptyComponent={target ? null : <Text style={styles.empty}>Drag a card here</Text>}
                renderItem={({ item }) => (
                  <BoardCard
                    task={item}
                    column={column.key}
                    dragging={item.id === dragId}
                    api={api}
                    offset={offset}
                    hideStatus={hideStatus}
                    today={today}
                    selected={selectedIds.includes(item.id)}
                    selecting={selecting}
                    onSelect={onSelect}
                    onToggle={onToggle}
                  />
                )}
              />
            </View>
          );
        })}
      </ScrollView>
      {drag ? (
        <Reanimated.View pointerEvents="none" style={[styles.floating, { width: drag.width }, floating]}>
          <TaskCard
            task={drag.task}
            today={today}
            selected={selectedIds.includes(drag.task.id)}
            selecting={selecting}
            onToggle={noop}
            hideStatus={hideStatus}
            trailing={<View style={styles.grip}><GripVertical size={18} color={colors.foreground} /></View>}
          />
        </Reanimated.View>
      ) : null}
    </View>
  );
}

function noop() {}

const styles = createThemedStyleSheet((colors) => ({
  scroller: { flex: 1 },
  board: {
    paddingHorizontal: BOARD_PADDING,
    paddingTop: 8,
    paddingBottom: 24,
    gap: COLUMN_GAP,
    flexGrow: 1,
    alignItems: "stretch",
  },
  column: {
    width: COLUMN_WIDTH,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { color: colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 },
  count: { color: colors.mutedForeground, fontSize: 12 },
  list: { flex: 1 },
  cards: { paddingHorizontal: 8, paddingBottom: 110 },
  columnTarget: { borderColor: colors.primary, backgroundColor: colors.accent },
  cardWrap: { marginBottom: 8 },
  // What stays behind while its card is lifted.
  placeholder: { opacity: 0.35 },
  grip: { width: 32, alignSelf: "stretch", alignItems: "center", justifyContent: "center", borderTopRightRadius: 16, borderBottomRightRadius: 16 },
  slot: {
    height: 48,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  slotText: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  floating: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 50,
    elevation: 12,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  empty: { color: colors.mutedForeground, fontSize: 12, paddingHorizontal: 4, paddingVertical: 8 },
}));
