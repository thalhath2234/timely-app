import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Keyboard, ScrollView, View, type LayoutChangeEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from "react-native";

type Host = {
  claim: (id: string, node: View | null) => void;
  release: (id: string) => void;
};

const HostContext = createContext<Host | null>(null);
const GroupContext = createContext<{ onFocus: () => void; onBlur: () => void } | null>(null);

/** Field reports its focus to the FocusGroup around it, if any. */
export function useFocusGroup() {
  return useContext(GroupContext);
}

/** An inline form whose own buttons sit below its fields (a new label with
 * its colours and "Add label"). While one of its fields has focus, the
 * FocusGroupScrollView around it scrolls the whole form above the keyboard,
 * and a sheet hides its footer so the form's button is the one on show. */
export function FocusGroup({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const host = useContext(HostContext);
  const id = useId();
  const ref = useRef<View>(null);
  const focused = useRef(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const value = useMemo(
    () => ({
      onFocus: () => {
        if (releaseTimer.current) clearTimeout(releaseTimer.current);
        releaseTimer.current = null;
        focused.current = true;
        host?.claim(id, ref.current);
      },
      // Moving between the form's own fields blurs one before focusing the
      // next; wait a tick so the sheet footer doesn't flash back in between.
      onBlur: () => {
        focused.current = false;
        releaseTimer.current = setTimeout(() => {
          releaseTimer.current = null;
          host?.release(id);
        }, 0);
      },
    }),
    [host, id],
  );

  useEffect(
    () => () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      host?.release(id);
    },
    [host, id],
  );

  return (
    <GroupContext.Provider value={value}>
      <View
        ref={ref}
        collapsable={false}
        style={style}
        testID={testID}
        // An option row added while typing grows the form: keep it in view.
        onLayout={() => {
          if (focused.current) host?.claim(id, ref.current);
        }}
      >
        {children}
      </View>
    </GroupContext.Provider>
  );
}

const MARGIN = 12;

/** ScrollView that keeps a focused FocusGroup fully above the keyboard. */
export function FocusGroupScrollView({
  onGroupChange,
  keyboardShouldPersistTaps = "handled",
  onLayout,
  onScroll,
  scrollEventThrottle = 16,
  children,
  ...props
}: ScrollViewProps & { onGroupChange?: (active: boolean) => void }) {
  const scrollRef = useRef<ScrollView>(null);
  const offset = useRef(0);
  const claimed = useRef<{ id: string; node: View | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    onGroupChange?.(active);
  }, [active, onGroupChange]);

  const reveal = useCallback(() => {
    const node = claimed.current?.node;
    const scroll = scrollRef.current;
    if (!node || !scroll) return;
    const frame = scroll.getNativeScrollRef();
    if (!frame) return;
    frame.measureInWindow((_sx, scrollY, _sw, viewport) => {
      node.measureInWindow((_x, y, _w, height) => {
        if (!viewport || !height) return;
        // Edge-to-edge screens don't shrink for the keyboard: stop at its top.
        const keyboard = Keyboard.metrics();
        const visible = keyboard ? Math.min(viewport, keyboard.screenY - scrollY) : viewport;
        const top = y - scrollY - MARGIN;
        const bottom = y - scrollY + height + MARGIN;
        let delta = 0;
        if (bottom > visible) delta = bottom - visible;
        // Taller than the space left: keep the top, where the typing is.
        if (top - delta < 0) delta = top;
        if (Math.abs(delta) < 1) return;
        scroll.scrollTo({ y: Math.max(0, offset.current + delta), animated: true });
      });
    });
  }, []);

  // Wait for the keyboard, the sheet's resize and Android's own scroll to
  // the focused field to settle before measuring.
  const revealSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(reveal, 120);
  }, [reveal]);

  const host = useMemo<Host>(
    () => ({
      claim: (id, node) => {
        claimed.current = { id, node };
        setActive(true);
        revealSoon();
      },
      release: (id) => {
        if (claimed.current?.id !== id) return;
        claimed.current = null;
        setActive(false);
      },
    }),
    [revealSoon],
  );

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => {
      if (claimed.current) revealSoon();
    });
    return () => {
      show.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [revealSoon]);

  return (
    <HostContext.Provider value={host}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        scrollEventThrottle={scrollEventThrottle}
        onScroll={(event) => {
          offset.current = event.nativeEvent.contentOffset.y;
          onScroll?.(event);
        }}
        onLayout={(event: LayoutChangeEvent) => {
          if (claimed.current) revealSoon();
          onLayout?.(event);
        }}
        {...props}
      >
        {children}
      </ScrollView>
    </HostContext.Provider>
  );
}
