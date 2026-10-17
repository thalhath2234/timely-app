import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, type ScrollView, type StyleProp, Text, View, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GripVertical, Trash2, type LucideIcon } from "lucide-react-native";
import type { DashboardCard } from "@timely/contract/dashboard";
import { HeaderIconButton } from "../ui/MobileHeader";
import { floatingTabBarInset } from "../ui/FloatingTabBar";
import { dropIndex, slotTop, type RowBox } from "../../lib/dashboardReorder";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/** Matches the screen list's `gap`, so the drop maths lines up with the rows. */
export const EDIT_ROW_GAP = 12;
/** How close to the top or bottom of the list the finger must be to scroll it while dragging. */
const EDGE_ZONE = 72;
const MAX_EDGE_SPEED = 14;
const SETTLE_MS = 180;

/** The screen's scroller, which the list scrolls while a card is dragged near its edge. */
export type EditListScroll = {
  ref: React.RefObject<ScrollView | null>;
  /** The scroller's frame, measured in the window when a drag starts. */
  frame: React.RefObject<View | null>;
  /** Kept current by the screen's onScroll / onContentSizeChange. */
  state: React.RefObject<{ y: number; contentH: number }>;
};

type Drag = { id: string; from: number; to: number; rows: RowBox[] };

type DragApi = {
  begin: (id: string, fingerY: number) => void;
  move: (fingerY: number) => void;
  end: (dropped: boolean) => void;
};

function Grip({ id, label, api, translation, onMove }: { id: string; label: string; api: React.RefObject<DragApi>; translation: { value: number }; onMove: (by: -1 | 1) => void }) {
  const pan = useMemo(() => {
    const begin = (fingerY: number) => api.current.begin(id, fingerY);
    const move = (fingerY: number) => api.current.move(fingerY);
    const end = (dropped: boolean) => api.current.end(dropped);
    // Starts on the first movement, like the Board's grip: the grip is the explicit affordance.
    return Gesture.Pan()
      .minDistance(1)
      .onStart((event) => {
        "worklet";
        translation.value = 0;
        scheduleOnRN(begin, event.absoluteY);
      })
      .onUpdate((event) => {
        "worklet";
        // The floating card follows the finger on the UI thread; the slot maths runs in JS.
        translation.value = event.translationY;
        scheduleOnRN(move, event.absoluteY);
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
  }, [api, id, translation]);
  return (
    // touchAction: on web, keeps the browser from scrolling the page (and cancelling the drag).
    <GestureDetector gesture={pan} touchAction="none">
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Drag to move this card, or use the Move up and Move down actions"
        accessibilityActions={[
          { name: "moveUp", label: "Move up" },
          { name: "moveDown", label: "Move down" },
        ]}
        onAccessibilityAction={(event) => onMove(event.nativeEvent.actionName === "moveUp" ? -1 : 1)}
        style={styles.grip}
      >
        <GripVertical size={18} color={colors.mutedForeground} />
      </View>
    </GestureDetector>
  );
}

/**
 * One row of the list. Rows keep their place in the tree while a card is
 * dragged (moving the dragged row's view would cancel its touch) and slide
 * by `offset` instead; the new order is committed on drop.
 */
function EditRow({ offset, animate, style, onLayout, children }: { offset: number; animate: boolean; style: StyleProp<ViewStyle>; onLayout: (event: LayoutChangeEvent) => void; children: ReactNode }) {
  const shift = useSharedValue(0);
  // A layout effect, so the reset on drop lands with the new order rather than a frame after it.
  useLayoutEffect(() => {
    shift.value = animate ? withTiming(offset, { duration: SETTLE_MS }) : offset;
  }, [animate, offset, shift]);
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: shift.value }] }));
  return (
    <Reanimated.View onLayout={onLayout} style={[style, moved]}>
      {children}
    </Reanimated.View>
  );
}

/** How far row `index` slides while the dragged row is headed for `drag.to`. */
function offsetFor(drag: Drag | null, index: number) {
  if (!drag || drag.from === drag.to) return 0;
  const { from, to, rows } = drag;
  if (index === from) return slotTop(rows, from, to, EDIT_ROW_GAP) - rows[from].y;
  const step = rows[from].h + EDIT_ROW_GAP;
  if (from < index && index <= to) return -step;
  if (to <= index && index < from) return step;
  return 0;
}

function RowBody({ card, icon: Icon, title, onRemove }: { card: DashboardCard; icon: LucideIcon; title: string; onRemove?: (card: DashboardCard) => void }) {
  return (
    <>
      <Icon size={15} color={colors.mutedForeground} />
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.remove}>
        {onRemove ? (
          <HeaderIconButton label={`Remove ${title}`} onPress={() => onRemove(card)}>
            <Trash2 size={17} color={colors.destructive} />
          </HeaderIconButton>
        ) : (
          <View style={styles.removeIcon}>
            <Trash2 size={17} color={colors.destructive} />
          </View>
        )}
      </View>
    </>
  );
}

/**
 * The Dashboard's edit mode on a phone: one row per card, dragged by the grip
 * on its left to a new place. The lifted card floats above the list while the
 * others slide aside to open a gap, and glides into the gap on release.
 * Screen readers move a card one place at a time with the grip's Move up / Move down actions.
 */
export default function DashboardEditList({
  cards,
  iconFor,
  titleFor,
  scroll,
  onReorder,
  onRemove,
  onDragging,
}: {
  cards: DashboardCard[];
  iconFor: (card: DashboardCard) => LucideIcon;
  titleFor: (card: DashboardCard) => string;
  scroll: EditListScroll;
  onReorder: (from: number, to: number) => void;
  onRemove: (card: DashboardCard) => void;
  /** True while a card is lifted, so the screen can pause pull-to-refresh. */
  onDragging?: (dragging: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const bottomBar = floatingTabBarInset(insets.bottom);
  const translation = useSharedValue(0);
  const scrollShift = useSharedValue(0);
  const baseY = useSharedValue(0);
  const lift = useSharedValue(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Row frames inside the list, by card id, kept current by onLayout.
  const boxes = useRef(new Map<string, RowBox>()).current;
  // Mutable drag bookkeeping read by the gesture callbacks and the edge-scroll loop.
  const live = useRef({
    active: false,
    ready: false,
    id: "",
    from: -1,
    to: -1,
    rows: [] as RowBox[],
    startY: 0,
    startScroll: 0,
    fingerY: 0,
    startFingerY: 0,
    frameTop: 0,
    frameH: 0,
    frame: 0 as number,
    settle: null as ReturnType<typeof setTimeout> | null,
  }).current;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onDraggingRef = useRef(onDragging);
  onDraggingRef.current = onDragging;

  const floating = useAnimatedStyle(() => ({
    opacity: lift.value === 0 ? 0 : 1,
    transform: [
      { translateY: baseY.value + translation.value + scrollShift.value },
      { scale: 1 + 0.03 * lift.value },
      { rotate: `${-1 * lift.value}deg` },
    ],
  }));

  const api = useRef<DragApi>(null as unknown as DragApi);
  api.current = useMemo<DragApi>(() => {
    const state = () => scroll.state.current;
    const track = () => {
      const top = live.startY + (live.fingerY - live.startFingerY) + (state().y - live.startScroll);
      const to = dropIndex(live.rows, live.from, top, EDIT_ROW_GAP);
      if (to !== live.to) {
        live.to = to;
        setDrag((current) => (current ? { ...current, to } : current));
      }
    };
    const edgeSpeed = () => {
      const local = live.fingerY - live.frameTop;
      const bottom = live.frameH - bottomBar;
      if (local < EDGE_ZONE) return -MAX_EDGE_SPEED * Math.min(1, (EDGE_ZONE - local) / EDGE_ZONE);
      if (local > bottom - EDGE_ZONE) return MAX_EDGE_SPEED * Math.min(1, (local - (bottom - EDGE_ZONE)) / EDGE_ZONE);
      return 0;
    };
    const tick = () => {
      live.frame = 0;
      if (!live.active || !live.ready) return;
      const speed = edgeSpeed();
      const max = Math.max(0, state().contentH - live.frameH);
      const next = Math.max(0, Math.min(max, state().y + speed));
      if (speed !== 0 && next !== state().y) {
        state().y = next;
        scroll.ref.current?.scrollTo({ y: next, animated: false });
        scrollShift.value = next - live.startScroll;
        track();
      }
      if (speed !== 0) live.frame = requestAnimationFrame(tick);
    };
    const finish = () => {
      if (live.settle) clearTimeout(live.settle);
      live.settle = null;
      live.active = false;
      live.ready = false;
      lift.value = 0;
      setDrag(null);
      onDraggingRef.current?.(false);
    };
    return {
      begin: (id, fingerY) => {
        if (live.active) return;
        if (live.settle) finish();
        const list = cardsRef.current;
        const from = list.findIndex((card) => card.id === id);
        const rows = list.map((card) => boxes.get(card.id));
        if (from < 0 || rows.some((row) => !row)) return;
        live.active = true;
        live.id = id;
        live.from = from;
        live.to = from;
        live.rows = rows as RowBox[];
        live.startY = live.rows[from].y;
        live.startScroll = state().y;
        live.fingerY = fingerY;
        live.startFingerY = fingerY;
        scrollShift.value = 0;
        baseY.value = live.startY;
        scroll.frame.current?.measureInWindow((_x, y, _w, h) => {
          if (!live.active || live.id !== id) return;
          live.frameTop = y;
          live.frameH = h;
          live.ready = true;
        });
        lift.value = withTiming(1, { duration: reduceMotion ? 0 : 120 });
        setDrag({ id, from, to: from, rows: live.rows });
        onDraggingRef.current?.(true);
      },
      move: (fingerY) => {
        if (!live.active) return;
        live.fingerY = fingerY;
        track();
        if (live.ready && !live.frame && edgeSpeed() !== 0) live.frame = requestAnimationFrame(tick);
      },
      end: (dropped) => {
        if (!live.active) return;
        if (live.frame) cancelAnimationFrame(live.frame);
        live.frame = 0;
        live.active = false;
        const from = live.from;
        const to = dropped ? live.to : from;
        if (!dropped && to !== live.to) setDrag((current) => (current ? { ...current, to } : current));
        // Glide into the gap (or back home when cancelled), then commit the order.
        const target = slotTop(live.rows, from, to, EDIT_ROW_GAP) - live.startY - scrollShift.value;
        const duration = reduceMotion ? 0 : SETTLE_MS;
        translation.value = withTiming(target, { duration });
        lift.value = withTiming(0.0001, { duration });
        live.settle = setTimeout(() => {
          if (from !== to) onReorderRef.current(from, to);
          finish();
        }, duration + 10);
      },
    };
  }, [baseY, bottomBar, boxes, lift, live, reduceMotion, scroll, scrollShift, translation]);

  useEffect(
    () => () => {
      if (live.frame) cancelAnimationFrame(live.frame);
      if (live.settle) clearTimeout(live.settle);
    },
    [live],
  );

  const lifted = drag ? cards.find((card) => card.id === drag.id) : undefined;
  const animate = drag !== null && !reduceMotion;

  return (
    <View style={styles.list}>
      {cards.map((card, index) => {
        const title = titleFor(card);
        const isGap = card.id === drag?.id;
        return (
          <EditRow
            key={card.id}
            offset={offsetFor(drag, index)}
            animate={animate}
            onLayout={(event) => {
              const { y, height } = event.nativeEvent.layout;
              boxes.set(card.id, { y, h: height });
            }}
            style={[styles.row, isGap && styles.gap]}
          >
            <View style={[styles.rowInner, isGap && styles.hidden]}>
              <Grip
                id={card.id}
                label={`${title}, ${index + 1} of ${cards.length}`}
                api={api}
                translation={translation}
                onMove={(by) => {
                  const to = index + by;
                  if (to >= 0 && to < cards.length) onReorder(index, to);
                }}
              />
              <RowBody card={card} icon={iconFor(card)} title={title} onRemove={onRemove} />
            </View>
          </EditRow>
        );
      })}
      {lifted ? (
        <Reanimated.View pointerEvents="none" style={[styles.row, styles.floating, floating]}>
          <View style={styles.rowInner}>
            <View style={styles.grip}>
              <GripVertical size={18} color={colors.foreground} />
            </View>
            <RowBody card={lifted} icon={iconFor(lifted)} title={titleFor(lifted)} />
          </View>
        </Reanimated.View>
      ) : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  list: { gap: EDIT_ROW_GAP },
  row: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  rowInner: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, paddingRight: 6 },
  // The open slot the lifted card will drop into.
  gap: { borderStyle: "dashed", borderWidth: 1.5, borderColor: colors.primary, backgroundColor: "transparent" },
  hidden: { opacity: 0 },
  grip: { width: 40, alignSelf: "stretch", alignItems: "center", justifyContent: "center", marginRight: -4 },
  title: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: "600" },
  remove: { paddingVertical: 6 },
  removeIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  floating: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    zIndex: 50,
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
}));
