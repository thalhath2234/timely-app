import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  FadeIn,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronLeft, X } from "lucide-react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { AccessoryLayer, overlayBottomPad } from "./SheetHost";
import { easeOut, overlayDuration, pageDuration, sheetExitDuration } from "../../lib/motion";
import AnimatedPressable from "./AnimatedPressable";
import { FocusGroupScrollView } from "./FocusGroup";
import { useKeyboardCover } from "./useKeyboardCover";

type SheetContent = {
  title?: string;
  subtitle?: string;
  leading?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

type SheetPage = SheetContent & { id: string; onClose: () => void };

type SheetStack = {
  upsert: (page: SheetPage) => void;
  remove: (id: string) => void;
};

/** Set by an open sheet: a sheet opened from inside it becomes a page of it. */
const SheetStackContext = createContext<SheetStack | null>(null);

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Small line under the title, such as the item a picker edits. */
  subtitle?: string;
  /** Replaces the title on the left of the header (a kind switcher chip). */
  leading?: ReactNode;
  children: ReactNode;
  /** Action bar under the body; it sits on top of the keyboard while typing. */
  footer?: ReactNode;
  onClosed?: () => void;
  /**
   * "auto" (default): opened from inside another sheet, it replaces that
   * sheet's body with a back arrow, so there is one sheet and one backdrop.
   * "modal" always opens its own sheet on top.
   */
  presentation?: "auto" | "modal";
};

/**
 * Timely's one pop-up sheet on the phone (docs/design-system.md#sheets):
 * grabber, header (title or a leading control, close), scrolling body and an
 * optional action bar that docks on top of the keyboard.
 */
export default function BottomSheet(props: SheetProps) {
  const stack = useContext(SheetStackContext);
  if (stack && props.presentation !== "modal") return <SheetPageEntry stack={stack} {...props} />;
  return <SheetModal {...props} />;
}

/** A sheet opened inside another one: shown in place of its body. */
function SheetPageEntry({ stack, open, onClose, onClosed, title, subtitle, leading, children, footer }: SheetProps & { stack: SheetStack }) {
  const id = useId();
  const wasOpen = useRef(false);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useLayoutEffect(() => {
    if (open) {
      wasOpen.current = true;
      stack.upsert({ id, onClose, title, subtitle, leading, children, footer });
      return;
    }
    stack.remove(id);
    if (wasOpen.current) {
      wasOpen.current = false;
      onClosedRef.current?.();
    }
  });

  useLayoutEffect(() => () => stack.remove(id), [id, stack]);
  return null;
}

/** Mounts the sheet only while it is open or closing, so closed sheets
 * (one behind every Select) do not follow the keyboard. */
function SheetModal(props: SheetProps) {
  const [alive, setAlive] = useState(props.open);
  if (props.open && !alive) setAlive(true);
  const gone = useCallback(() => setAlive(false), []);
  if (!alive) return null;
  return <SheetFrame {...props} onGone={gone} />;
}

function SheetFrame({ open, onClose, title, subtitle, leading, children, footer, onClosed, onGone }: SheetProps & { onGone: () => void }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const keyboardCover = useKeyboardCover();
  const [mounted, setMounted] = useState(open);
  const [rootHeight, setRootHeight] = useState(windowHeight);
  const [pages, setPages] = useState<SheetPage[]>([]);
  // An inline form (a new label) is being typed in: its own button, not the
  // footer's, is the one to show above the keyboard.
  const [groupActive, setGroupActive] = useState(false);
  const progress = useSharedValue(open && reduceMotion ? 1 : 0);
  const drag = useSharedValue(0);
  const openRef = useRef(open);
  const onClosedRef = useRef(onClosed);
  const contentRef = useRef<SheetContent>({ title, subtitle, leading, children, footer });

  useLayoutEffect(() => {
    openRef.current = open;
    if (open) contentRef.current = { title, subtitle, leading, children, footer };
  }, [children, footer, leading, open, subtitle, title]);

  const presented = open ? { title, subtitle, leading, children, footer } : contentRef.current;
  const page = pages.length > 0 ? pages[pages.length - 1] : null;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  useEffect(() => {
    onClosedRef.current = onClosed;
  }, [onClosed]);

  const stack = useMemo<SheetStack>(
    () => ({
      upsert: (next) =>
        setPages((current) => {
          const index = current.findIndex((entry) => entry.id === next.id);
          if (index === -1) return [...current, next];
          const copy = current.slice();
          copy[index] = next;
          return copy;
        }),
      remove: (id) => setPages((current) => (current.some((entry) => entry.id === id) ? current.filter((entry) => entry.id !== id) : current)),
    }),
    [],
  );

  const finishClose = useCallback(() => {
    if (openRef.current) return;
    setMounted(false);
    // Closed from a page (X, pull down): close its pickers too, so the sheet
    // opens on its own body next time.
    for (const entry of pagesRef.current.slice().reverse()) entry.onClose();
    setPages([]);
    onClosedRef.current?.();
    onGone();
  }, [onGone]);

  useEffect(() => {
    cancelAnimation(progress);
    if (open) {
      drag.value = 0;
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
  }, [drag, finishClose, mounted, open, progress, reduceMotion]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - Math.min(drag.value / 400, 0.6)),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * windowHeight + drag.value }],
  }));

  useLayoutEffect(() => {
    if (open && Keyboard.isVisible()) Keyboard.dismiss();
  }, [open]);

  // A picker page has no text field of its own: put the keyboard away so
  // its options are not hidden behind it.
  const pageId = page?.id;
  useEffect(() => {
    if (pageId && Keyboard.isVisible()) Keyboard.dismiss();
  }, [pageId]);

  const back = page?.onClose;
  const dismiss = useCallback(() => {
    if (back) back();
    else onClose();
  }, [back, onClose]);

  // Pull the grabber or header down to close; a short pull springs back.
  const pull = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-24, 24])
        .onUpdate((event) => {
          drag.value = Math.max(0, event.translationY);
        })
        .onEnd((event) => {
          if (event.translationY > 96 || event.velocityY > 900) {
            runOnJS(onClose)();
            return;
          }
          drag.value = withTiming(0, { duration: overlayDuration, easing: easeOut });
        }),
    [drag, onClose],
  );

  const typing = keyboardCover > 0;
  const shown = page ?? presented;
  const footerNode = shown.footer && !(groupActive && typing) ? shown.footer : null;
  // Keep a strip of the screen above a tall sheet so it reads as a sheet.
  const available = rootHeight - keyboardCover - Math.max(insets.top, 12) - (typing ? 8 : 32);

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      hardwareAccelerated={Platform.OS === "android"}
      onRequestClose={dismiss}
    >
      <GestureHandlerRootView style={styles.root} onLayout={(event) => setRootHeight(event.nativeEvent.layout.height)}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={page ? "Back" : "Close"}
            style={StyleSheet.absoluteFill}
            onPress={dismiss}
          />
        </Animated.View>
        <View pointerEvents="box-none" style={[styles.foreground, { paddingBottom: keyboardCover }]}>
          <Animated.View
            style={[
              styles.sheet,
              { paddingBottom: typing ? 0 : overlayBottomPad(insets.bottom), maxHeight: Math.max(240, available) },
              sheetStyle,
            ]}
          >
            <GestureDetector gesture={pull}>
              <View collapsable={false}>
                <View style={styles.grabberRow}>
                  <View style={styles.grabber} />
                </View>
                <SheetHeader
                  title={page ? page.title : presented.title}
                  subtitle={page ? page.subtitle ?? presented.title : presented.subtitle}
                  leading={page ? page.leading : presented.leading}
                  onBack={page?.onClose}
                  onClose={onClose}
                />
              </View>
            </GestureDetector>
            <SheetStackContext.Provider value={stack}>
              <FocusGroupScrollView
                onGroupChange={setGroupActive}
                keyboardShouldPersistTaps="always"
                keyboardDismissMode="on-drag"
                nestedScrollEnabled
                bounces={false}
                style={[styles.body, page ? styles.hidden : null]}
                contentContainerStyle={styles.bodyContent}
              >
                {presented.children}
              </FocusGroupScrollView>
            </SheetStackContext.Provider>
            {/* Every open page stays mounted (only the top one shows), so a
                picker opened from a page (a field's type on its edit page)
                keeps the page that owns it alive. */}
            {pages.map((entry) => (
              <SheetStackContext.Provider key={entry.id} value={stack}>
                <Animated.View
                  entering={reduceMotion ? undefined : FadeIn.duration(overlayDuration)}
                  style={[styles.pageWrap, entry !== page ? styles.hidden : null]}
                >
                  <FocusGroupScrollView
                    onGroupChange={setGroupActive}
                    keyboardShouldPersistTaps="always"
                    keyboardDismissMode="on-drag"
                    nestedScrollEnabled
                    bounces={false}
                    style={styles.body}
                    contentContainerStyle={styles.bodyContent}
                  >
                    {entry.children}
                  </FocusGroupScrollView>
                </Animated.View>
              </SheetStackContext.Provider>
            ))}
            {footerNode ? <View style={[styles.footer, typing && styles.footerTyping]}>{footerNode}</View> : null}
          </Animated.View>
        </View>
        <AccessoryLayer />
      </GestureHandlerRootView>
    </Modal>
  );
}

function SheetHeader({
  title,
  subtitle,
  leading,
  onBack,
  onClose,
}: {
  title?: string;
  subtitle?: string;
  leading?: ReactNode;
  onBack?: () => void;
  onClose: () => void;
}) {
  if (!title && !leading && !onBack) return <View style={styles.headerSpacer} />;
  return (
    <View style={[styles.header, onBack ? styles.headerBack : null]}>
      {onBack ? (
        <AnimatedPressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back} hitSlop={6}>
          <ChevronLeft size={22} color={colors.foreground} />
        </AnimatedPressable>
      ) : null}
      <View style={styles.headerText}>
        {leading ?? (
          <>
            {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
            {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </>
        )}
      </View>
      <AnimatedPressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close} hitSlop={8}>
        <X size={18} color={colors.mutedForeground} />
      </AnimatedPressable>
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
    flexGrow: 0,
    backgroundColor: colors.popover,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  grabberRow: { height: 20, alignItems: "center", justifyContent: "center" },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },
  headerSpacer: { height: 4 },
  header: { minHeight: 48, paddingLeft: 20, paddingRight: 12, paddingBottom: 4, flexDirection: "row", alignItems: "center", gap: 8 },
  headerBack: { paddingLeft: 6 },
  headerText: { flex: 1, minWidth: 0, justifyContent: "center" },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: colors.foreground, fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
  subtitle: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500", marginTop: 1 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 20, flexGrow: 0, flexShrink: 1 },
  hidden: { display: "none" },
  pageWrap: { flexShrink: 1, minHeight: 0 },
  bodyContent: { paddingTop: 4, paddingBottom: 12 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.popover,
  },
  footerTyping: { paddingBottom: 10 },
  option: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  optionOn: { backgroundColor: colors.accent },
  optionText: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" },
}));
