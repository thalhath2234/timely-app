import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import BottomSheet from "./BottomSheet";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { Button } from "./primitives";

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
  tone = "destructive",
  icon,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "primary" for a confirm that removes nothing (Pause all bots). */
  tone?: "destructive" | "primary";
  /** The confirm button's icon; a delete gets the bin by default. */
  icon?: ReactNode;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <View style={styles.row}>
          <View style={styles.cell}>
            <Button label={cancelLabel} variant="secondary" size="lg" stretch onPress={onClose} />
          </View>
          <View style={styles.cell}>
            <Button
              label={confirmLabel}
              variant={tone === "primary" ? "primary" : "destructive"}
              size="lg"
              stretch
              icon={
                icon ??
                (tone === "destructive" && /delete|remove|revoke|clear/.test(confirmLabel.toLowerCase()) ? (
                  <Trash2 size={16} color={colors.destructiveForeground} />
                ) : undefined)
              }
              onPress={() => {
                onClose();
                onConfirm();
              }}
            />
          </View>
        </View>
      }
    >
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  message: { color: colors.mutedForeground, fontSize: 15, lineHeight: 22, paddingBottom: 16 },
  row: { flexDirection: "row", gap: 10 },
  cell: { flex: 1 },
}));
