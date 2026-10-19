import { ScrollView, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { describeView, type ViewChip, type ViewVocabulary } from "@timely/contract/viewLanguage";
import type { TaskViewConfig } from "../../lib/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import { Button } from "../ui/primitives";

/** Chip keys the View sheet already has controls for. */
function hasControl(chip: ViewChip): boolean {
  return !(chip.key.startsWith("rule:") || chip.key === "match:any" || chip.key === "sort:then" || chip.key === "limit");
}

/**
 * One pill per part of a view [natural-language views], matching the web's
 * chips. With `onRemove` each pill has an x that takes that part off.
 */
export function ViewChips({
  chips,
  onRemove,
  wrap,
}: {
  chips: ViewChip[];
  onRemove?: (chip: ViewChip) => void;
  /** Wrap onto more lines instead of one scrolling row. */
  wrap?: boolean;
}) {
  return (
    <View style={[styles.chips, wrap ? styles.chipsWrap : null]} accessibilityLabel="What this view shows">
      {chips.map((chip) => (
        <View key={chip.key} style={[styles.chip, onRemove ? styles.chipRemovable : null]}>
          <Text numberOfLines={1} style={styles.chipText}>
            {chip.label}
          </Text>
          {onRemove ? (
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${chip.label}`}
              hitSlop={10}
              onPress={() => onRemove(chip)}
              style={styles.chipX}
            >
              <X size={13} color={colors.mutedForeground} />
            </AnimatedPressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * The view's rules, second sort and limit as removable chips above the
 * list. For a Preview from Search it shows every part of the view, with
 * Save as view and Close.
 */
export default function ViewRulesBar({
  view,
  vocab,
  onPatch,
  preview,
}: {
  view: TaskViewConfig | undefined;
  vocab: ViewVocabulary;
  onPatch: (patch: Partial<TaskViewConfig>) => void;
  preview?: { onSave: () => void; onClose: () => void };
}) {
  if (!view) return null;
  const all = describeView(view, vocab);
  const chips = preview ? all : all.filter((chip) => !hasControl(chip));
  if (!preview && chips.length === 0) return null;
  return (
    <View style={[styles.bar, preview ? styles.barPreview : null]}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {preview ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Preview</Text>
          </View>
        ) : null}
        <ViewChips chips={chips} onRemove={(chip) => onPatch(chip.remove)} />
      </ScrollView>
      {preview ? (
        <View style={styles.actions}>
          <Button label="Close" variant="ghost" size="sm" onPress={preview.onClose} />
          <Button label="Save as view" size="sm" onPress={preview.onSave} />
        </View>
      ) : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  bar: { paddingVertical: 8, gap: 8 },
  barPreview: { backgroundColor: `${colors.primary}0F`, borderBottomWidth: 1, borderBottomColor: colors.border },
  scroll: { paddingHorizontal: 16, alignItems: "center", gap: 6 },
  chips: { flexDirection: "row", alignItems: "center", gap: 6 },
  chipsWrap: { flexWrap: "wrap" },
  chip: {
    height: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
    backgroundColor: colors.muted,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: 260,
  },
  chipRemovable: { paddingRight: 6 },
  chipText: { fontSize: 13, fontWeight: "500", color: colors.foreground, flexShrink: 1 },
  chipX: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  badge: { borderRadius: 999, paddingHorizontal: 10, height: 24, justifyContent: "center", backgroundColor: `${colors.primary}1F` },
  badgeText: { fontSize: 12, fontWeight: "600", color: colors.primary },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingHorizontal: 16 },
}));
