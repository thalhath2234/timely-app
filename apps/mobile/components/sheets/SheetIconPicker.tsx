import { Pressable, Text, View } from "react-native";
import BottomSheet from "../ui/BottomSheet";
import { SHEET_ICON_CHOICES } from "../../lib/sheet";
import { createThemedStyleSheet } from "../../lib/theme";

/** Emoji icon picker shared by the sheet and template editors. Selecting "" removes the icon. */
export default function SheetIconPicker({
  open,
  onClose,
  value,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onSelect: (icon: string) => void;
}) {
  const choose = (icon: string) => {
    onSelect(icon);
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Icon">
      <View style={styles.iconGrid}>
        {SHEET_ICON_CHOICES.map((choice) => (
          <Pressable
            key={choice}
            accessibilityRole="button"
            accessibilityLabel={`Use icon ${choice}`}
            onPress={() => choose(choice)}
            hitSlop={6}
            style={[styles.iconChoice, choice === value && styles.iconChoiceOn]}
          >
            <Text style={styles.icon}>{choice}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={() => choose("")} style={styles.removeIcon}>
        <Text style={styles.removeIconText}>Remove icon</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  iconChoice: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconChoiceOn: { backgroundColor: colors.accent },
  icon: { fontSize: 26 },
  removeIcon: {
    marginTop: 12,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  removeIconText: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
}));
