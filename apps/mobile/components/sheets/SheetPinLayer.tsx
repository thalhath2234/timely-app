import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Animated, Platform, type StyleProp, type View, type ViewStyle } from "react-native";
import type { ScrollRest } from "../../lib/sheetFreeze";

type Shift = Animated.AnimatedInterpolation<number>;

const WEB = Platform.OS === "web";

/**
 * One frozen layer of the phone grid (the pinned columns, the pinned rows or
 * their corner). It sits inside the scrolled content and slides back by the
 * scroll offset on the native animation driver, which Android applies while
 * it handles the scroll itself, in the same frame, whatever the JS thread or
 * a React render is doing.
 *
 * React never sees those native updates, so once the grid stops the layer
 * also hands its resting offset to React; otherwise presses on pinned cells
 * would be measured where the cells were before the scroll. React Native's
 * own sticky headers do the same.
 *
 * The web has no native driver (Animated would move the layer through a
 * React render, a frame late), so there the layer is moved directly from the
 * scroll event instead.
 */
export default function SheetPinLayer({
  shiftX,
  shiftY,
  rest,
  style,
  children,
}: {
  shiftX?: Shift;
  shiftY?: Shift;
  rest: ScrollRest;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const restX = useSyncExternalStore(rest.subscribe, () => (shiftX && !WEB ? rest.rest().x : 0));
  const restY = useSyncExternalStore(rest.subscribe, () => (shiftY && !WEB ? rest.rest().y : 0));
  const slide = useMemo(
    () =>
      WEB
        ? null
        : {
            transform: [
              ...(shiftX ? [{ translateX: shiftX }] : []),
              ...(shiftY ? [{ translateY: shiftY }] : []),
            ],
          },
    [shiftX, shiftY],
  );
  const atRest = useMemo(
    () =>
      WEB
        ? null
        : {
            style: {
              transform: [
                ...(shiftX ? [{ translateX: restX }] : []),
                ...(shiftY ? [{ translateY: restY }] : []),
              ],
            },
          },
    [shiftX, shiftY, restX, restY],
  );

  const layer = useRef<View>(null);
  const followX = Boolean(shiftX);
  const followY = Boolean(shiftY);
  useLayoutEffect(() => {
    if (!WEB) return;
    // On the web a View's ref is its DOM element.
    const node = layer.current as unknown as HTMLElement | null;
    if (!node) return;
    const move = () => {
      const { x, y } = rest.live();
      node.style.transform = `translate(${followX ? x : 0}px, ${followY ? y : 0}px)`;
    };
    move();
    return rest.watch(move);
  }, [rest, followX, followY]);

  return (
    <Animated.View
      ref={layer}
      collapsable={false}
      pointerEvents="box-none"
      style={[style, slide]}
      // @ts-expect-error React Native's sticky headers use this prop; its types leave it out.
      passthroughAnimatedPropExplicitValues={atRest}
    >
      {children}
    </Animated.View>
  );
}
