import { type ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors } from "../../lib/theme";

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export function SheetOption({
  selected,
  onSelect,
  children,
  leading,
}: {
  selected?: boolean;
  onSelect: () => void;
  children: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <Pressable onPress={onSelect} style={[styles.option, selected && styles.optionOn]}>
      {leading}
      <Text style={[styles.optionText, selected && { color: colors.accentForeground }]}>{children}</Text>
      {selected ? <Text style={styles.selected}>Selected</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { backgroundColor: "rgba(10,10,14,0.6)" },
  sheet: {
    maxHeight: "92%",
    backgroundColor: colors.popover,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingBottom: 16,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
    marginTop: 10,
    marginBottom: 8,
  },
  title: { color: colors.foreground, fontSize: 17, fontWeight: "600", paddingHorizontal: 20, marginBottom: 8 },
  body: { paddingHorizontal: 16 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: 16 },
  option: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  optionOn: { backgroundColor: colors.accent },
  optionText: { flex: 1, color: colors.foreground, fontSize: 15 },
  selected: { color: colors.accentForeground, fontSize: 12, fontWeight: "500" },
});
