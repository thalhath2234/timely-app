import { type ReactNode, useEffect } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { X } from "lucide-react-native";
import { overlayEntering, overlayExiting } from "../../lib/motion";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { useSheetInsets, useSheetLayer } from "./SheetHost";

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
  useEffect(() => {
    if (open) Keyboard.dismiss();
  }, [open]);

  useSheetLayer(open, onClose, () => (
    <SheetChrome onClose={onClose} title={title} footer={footer}>
      {children}
    </SheetChrome>
  ));

  return null;
}

function SheetChrome({
  onClose,
  title,
  children,
  footer,
}: {
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { bottom } = useSheetInsets();
  const reduceMotion = useReducedMotion();

  return (
    <View style={styles.root} collapsable={false}>
      <Animated.View
        entering={overlayEntering(reduceMotion)}
        exiting={overlayExiting(reduceMotion)}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
      </Animated.View>
      <View pointerEvents="auto" style={[styles.sheet, { paddingBottom: bottom }]}>
        <View style={styles.handle} />
        {title ? (
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
              <X size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : null}
        <ScrollView
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="on-drag"
          nestedScrollEnabled
          bounces={false}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
        >
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </View>
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
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onSelect}
      hitSlop={8}
      style={[styles.option, selected && styles.optionOn]}
    >
      {leading}
      {typeof children === "string" ? (
        <Text style={[styles.optionText, selected && { color: colors.accentForeground }]}>{children}</Text>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
      {selected ? <Text style={styles.selected}>Selected</Text> : null}
    </Pressable>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
  },
  backdrop: { backgroundColor: "rgba(8,9,12,0.72)" },
  sheet: {
    width: "100%",
    maxHeight: "92%",
    margin: 0,
    backgroundColor: colors.popover,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    ...Platform.select({
      android: { elevation: 24 },
      default: {},
    }),
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
  titleRow: { minHeight: 52, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, color: colors.foreground, fontSize: 18, fontWeight: "700", letterSpacing: -0.25 },
  close: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 16, flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingBottom: 8 },
  footer: { borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.card },
  option: {
    minHeight: 52,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  optionOn: { backgroundColor: "rgba(99,102,241,0.16)" },
  optionText: { flex: 1, color: colors.foreground, fontSize: 15 },
  selected: { color: colors.accentForeground, fontSize: 12, fontWeight: "500" },
}));
