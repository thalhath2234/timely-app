import { type ReactNode, useLayoutEffect } from "react";
import { Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { colors, createThemedStyleSheet, radius } from "../../lib/theme";
import { AccessoryLayer, overlayBottomPad } from "./SheetHost";
import { overlayEntering, sheetEntering } from "../../lib/motion";
import AnimatedPressable from "./AnimatedPressable";

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
  const insets = useSafeAreaInsets();
  const bottom = overlayBottomPad(insets.bottom);
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    if (open && Keyboard.isVisible()) Keyboard.dismiss();
  }, [open]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      hardwareAccelerated={Platform.OS === "android"}
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View entering={overlayEntering(Boolean(reduceMotion))} style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        </Animated.View>
        <View pointerEvents="box-none" style={styles.foreground}>
          <Animated.View entering={sheetEntering(Boolean(reduceMotion))} style={[styles.sheet, { paddingBottom: bottom }]}>
            <View style={styles.handle} />
            {title ? (
              <View style={styles.titleRow}>
                <Text style={styles.title}>{title}</Text>
                <AnimatedPressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={onClose}
                  style={styles.close}
                  hitSlop={8}
                >
                  <X size={18} color={colors.mutedForeground} />
                </AnimatedPressable>
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
          </Animated.View>
        </View>
        <AccessoryLayer />
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
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onSelect}
      android_ripple={{ color: `${colors.primary}22` }}
      style={[styles.option, selected && styles.optionOn]}
    >
      {leading}
      {typeof children === "string" ? (
        <Text style={[styles.optionText, selected && { color: colors.accentForeground }]}>{children}</Text>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
      {selected ? <Text style={styles.selected}>Selected</Text> : null}
    </AnimatedPressable>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(8,9,12,0.72)",
  },
  foreground: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    width: "100%",
    maxHeight: "92%",
    flexGrow: 0,
    backgroundColor: colors.popover,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.muted,
    marginTop: 10,
    marginBottom: 8,
  },
  titleRow: { minHeight: 52, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, color: colors.foreground, fontSize: 18, fontWeight: "700", letterSpacing: -0.25 },
  close: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 16, flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingBottom: 8 },
  footer: {
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.card,
  },
  option: {
    minHeight: 52,
    borderRadius: radius,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  optionOn: { backgroundColor: colors.accent },
  optionText: { flex: 1, color: colors.foreground, fontSize: 15 },
  selected: { color: colors.accentForeground, fontSize: 12, fontWeight: "500" },
}));
