import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, X } from "lucide-react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { AccessoryLayer, overlayBottomPad } from "./SheetHost";
import { easeOut, pageDuration, sheetExitDuration } from "../../lib/motion";
import AnimatedPressable from "./AnimatedPressable";

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  onClosed,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClosed?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const bottom = overlayBottomPad(insets.bottom);
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [sheetHeight, setSheetHeight] = useState(windowHeight);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const progress = useSharedValue(open && reduceMotion ? 1 : 0);
  const openRef = useRef(open);
  const onClosedRef = useRef(onClosed);
  const contentRef = useRef({ title, children, footer });

  useLayoutEffect(() => {
    openRef.current = open;
    if (open) contentRef.current = { title, children, footer };
  }, [children, footer, open, title]);

  const presented = open ? { title, children, footer } : contentRef.current;

  useEffect(() => {
    onClosedRef.current = onClosed;
  }, [onClosed]);

  const finishClose = useCallback(() => {
    if (openRef.current) return;
    setMounted(false);
    onClosedRef.current?.();
  }, []);

  useEffect(() => {
    cancelAnimation(progress);
    if (open) {
      if (!mounted) {
        progress.value = 0;
        setMounted(true);
        return;
      }
      progress.value = reduceMotion
        ? 1
        : withTiming(1, { duration: pageDuration, easing: easeOut });
      return;
    }
    if (!mounted) return;
    if (reduceMotion) {
      progress.value = 0;
      finishClose();
      return;
    }
    progress.value = withTiming(
      0,
      { duration: sheetExitDuration, easing: easeOut },
      (finished) => {
        if (finished) runOnJS(finishClose)();
      },
    );
  }, [finishClose, mounted, open, progress, reduceMotion]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * windowHeight }],
  }));

  useLayoutEffect(() => {
    if (open && Keyboard.isVisible()) Keyboard.dismiss();
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const show = Keyboard.addListener("keyboardDidShow", (event) => setKeyboardTop(event.endCoordinates.screenY));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardTop(null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [mounted]);

  useEffect(() => {
    if (!open) setKeyboardTop(null);
  }, [open]);

  const keyboardOverlap = keyboardTop === null ? 0 : Math.max(0, sheetHeight - keyboardTop);
  const availableHeight = sheetHeight - keyboardOverlap;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      hardwareAccelerated={Platform.OS === "android"}
      onRequestClose={onClose}
    >
      <View style={styles.root} onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={StyleSheet.absoluteFill}
            onPress={onClose}
          />
        </Animated.View>
        <View pointerEvents="box-none" style={[styles.foreground, { paddingBottom: keyboardOverlap }]}>
          <Animated.View style={[styles.sheet, { paddingBottom: bottom, maxHeight: availableHeight * 0.92 }, sheetStyle]}>
            {presented.title ? (
              <View style={styles.titleRow}>
                <Text style={styles.title}>{presented.title}</Text>
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
              {presented.children}
            </ScrollView>
            {presented.footer ? <View style={styles.footer}>{presented.footer}</View> : null}
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
      {selected ? <Check size={18} color={colors.primary} strokeWidth={2.5} /> : null}
    </AnimatedPressable>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(8,9,12,0.54)",
  },
  foreground: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  sheet: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "92%",
    flexGrow: 0,
    backgroundColor: colors.popover,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
  },
  titleRow: { minHeight: 64, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, color: colors.foreground, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 20, flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingBottom: 12 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.popover,
  },
  option: {
    minHeight: 56,
    borderRadius: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  optionOn: { backgroundColor: colors.accent },
  optionText: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" },
}));
