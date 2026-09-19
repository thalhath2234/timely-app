import { Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import BottomSheet from "./BottomSheet";
import AnimatedPressable from "./AnimatedPressable";
import { createThemedStyleSheet } from "../../lib/theme";

export type ConfirmRequest = {
  title: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
};

export default function ConfirmSheet({
  open,
  onClose,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <View style={styles.row}>
          <AnimatedPressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </AnimatedPressable>
          <AnimatedPressable
            accessibilityRole="button"
            onPress={() => {
              onClose();
              onConfirm();
            }}
            style={styles.confirm}
          >
            {/delete|remove|revoke|clear/.test(confirmLabel.toLowerCase()) ? <Trash2 size={16} color="#fff" /> : null}
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          </AnimatedPressable>
        </View>
      }
    >
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  message: { color: colors.mutedForeground, fontSize: 14, paddingHorizontal: 4, paddingBottom: 16 },
  row: { flexDirection: "row", gap: 8, paddingBottom: 4 },
  cancel: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
  confirm: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.destructive,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  confirmText: { color: "#fff", fontSize: 15, fontWeight: "600" },
}));
