import { ScrollView, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { Plus } from "lucide-react-native";
import type { TaskViewConfig } from "../../lib/types";
import { colors, createThemedStyleSheet, radius } from "../../lib/theme";
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

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
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
                onLayout={(event) => onItemLayout(view.id, event)}
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
  wrap: { paddingBottom: 10 },
  scroller: { flexGrow: 1, paddingHorizontal: 12, paddingVertical: 2 },
  track: {
    flexGrow: 1,
    padding: 3,
    borderRadius: radius,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
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
    borderRadius: radius - 4,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.ring,
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
