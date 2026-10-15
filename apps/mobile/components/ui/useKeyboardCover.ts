import { useEffect, useState } from "react";
import { Dimensions, Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type KeyboardCoords = { height: number; screenY: number };

/**
 * How far up from the bottom of the screen the keyboard reaches.
 *
 * Android draws edge to edge, so the window no longer shrinks for the
 * keyboard, and React Native reports the keyboard's height without the
 * navigation bar under it. Lifting by that height alone leaves the bottom of
 * a docked form behind the keyboard, so the bar's inset is added back.
 */
export function keyboardCover(coords: KeyboardCoords | null | undefined, navigationInset: number) {
  if (!coords || coords.height <= 0) return 0;
  const fromTop = Math.round(Dimensions.get("screen").height - coords.screenY);
  const height = Platform.OS === "android" ? coords.height + navigationInset : coords.height;
  return Math.max(height, fromTop, 0);
}

/**
 * The keyboard's cover in points, 0 while it is down. A screen whose bottom
 * edge is the bottom of the screen pads its bottom by this to keep a docked
 * input and its button above the keyboard.
 */
export function useKeyboardCover() {
  const insets = useSafeAreaInsets();
  const [coords, setCoords] = useState<KeyboardCoords | null>(() => Keyboard.metrics?.() ?? null);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    // Both platforms send the show event again when the keyboard changes
    // height while up (emoji panel, suggestion strip).
    const onShow = (event: { endCoordinates: KeyboardCoords }) => setCoords(event.endCoordinates);
    const show = Keyboard.addListener(showEvent, onShow);
    const hide = Keyboard.addListener(hideEvent, () => setCoords(null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return keyboardCover(coords, insets.bottom);
}
