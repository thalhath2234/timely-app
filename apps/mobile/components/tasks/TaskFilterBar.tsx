import { useEffect, useRef } from "react";
import { ScrollView, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated from "react-native-reanimated";
import { Plus } from "lucide-react-native";
import type { TaskViewConfig } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { Chip } from "../ui/primitives";
import AnimatedPressable from "../ui/AnimatedPressable";
import { useSlidingPill } from "../ui/useSlidingPill";

export default function TaskFilterBar({
  views,
  activeViewId,
  onView,
  onAdd,
}: {
  views: TaskViewConfig[];
  activeViewId: string;
  onView: (id: string) => void;
  onAdd?: () => void;
}) {
  const activeChipId = views.some((view) => view.id === activeViewId) ? activeViewId : views[0]?.id;
  const { onItemLayout, pillStyle } = useSlidingPill(activeChipId);
  const scroller = useRef<ScrollView>(null);
  const layouts = useRef(new Map<string, { x: number; width: number }>());
  const { width: screenWidth } = useWindowDimensions();
  // Keep the active view in sight, e.g. one opened from search or chat at the
  // end of a long list.
  const reveal = (id: string | undefined, animated = true) => {
    const box = id ? layouts.current.get(id) : undefined;
    if (!box) return;
    scroller.current?.scrollTo({ x: Math.max(0, box.x + box.width / 2 - screenWidth / 2), animated });
  };
  useEffect(() => {
    reveal(activeChipId);
  }, [activeChipId]);
  const onSlotLayout = (id: string, event: LayoutChangeEvent) => {
    onItemLayout(id, event);
    const { x, width } = event.nativeEvent.layout;
    layouts.current.set(id, { x, width });
    if (id === activeChipId) requestAnimationFrame(() => reveal(id, false));
  };

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scroller}
        horizontal
        // The chips can lay out before the strip is wide enough to scroll.
        onContentSizeChange={() => reveal(activeChipId, false)}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.scroller}
      >
        <View style={styles.track}>
          <View style={styles.row}>
            <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]} />
            {views.map((view) => (
              <View
                key={view.id}
                collapsable={false}
                style={styles.chipSlot}
                onLayout={(event) => onSlotLayout(view.id, event)}
              >
                <Chip bare fill label={view.name} active={view.id === activeChipId} onPress={() => onView(view.id)} />
              </View>
            ))}
            {onAdd ? (
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel="Add view"
                onPress={onAdd}
                style={styles.add}
              >
                <Plus size={16} color={colors.mutedForeground} />
                <Text style={styles.addText}>Add</Text>
              </AnimatedPressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { paddingBottom: 12 },
  scroller: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 2 },
  track: {
    flexGrow: 1,
    padding: 3,
    borderRadius: 20,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  row: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  chipSlot: { flexGrow: 1, flexShrink: 0 },
  pill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 16,
    backgroundColor: colors.primary,
  },
  add: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    minHeight: 32,
  },
  addText: { color: colors.mutedForeground, fontSize: 13, fontWeight: "600" },
}));
