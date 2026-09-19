import { Platform } from "react-native";
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  LinearTransition,
  SlideInDown,
  SlideOutDown,
  type WithSpringConfig,
} from "react-native-reanimated";

/** Matches web `springSoft` in `apps/web/app/_components/_ui/motion.tsx`. */
export const springSoft: WithSpringConfig = {
  damping: 32,
  stiffness: 420,
  mass: 0.85,
};

/** Matches web `springSnappy`. */
export const springSnappy: WithSpringConfig = {
  damping: 36,
  stiffness: 520,
  mass: 0.7,
};

export const overlayDuration = 280;
export const pageDuration = 400;
export const sheetExitDuration = 280;

export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

export function stackPushAnimation(reduceMotion: boolean) {
  if (reduceMotion) return "none" as const;
  return Platform.OS === "ios" ? ("ios_from_right" as const) : ("slide_from_right" as const);
}

export function stackFadeAnimation(reduceMotion: boolean) {
  return reduceMotion ? ("none" as const) : ("fade" as const);
}

export function tabAnimation(reduceMotion: boolean) {
  return reduceMotion ? ("none" as const) : ("fade" as const);
}

export function listEntering(index = 0, reduceMotion = false) {
  if (reduceMotion) return undefined;
  return FadeInDown.delay(Math.min(index, 8) * 35)
    .duration(pageDuration)
    .easing(easeOut);
}

export function pageEntering(reduceMotion = false) {
  if (reduceMotion) return undefined;
  return FadeInDown.duration(pageDuration).easing(easeOut);
}

export function toastEntering(reduceMotion = false) {
  if (reduceMotion) return undefined;
  return FadeInUp.duration(overlayDuration).easing(easeOut);
}

export function toastExiting(reduceMotion = false) {
  if (reduceMotion) return undefined;
  return FadeOut.duration(140).easing(easeOut);
}

export function overlayEntering(reduceMotion = false) {
  if (reduceMotion) return undefined;
  return FadeIn.duration(overlayDuration).easing(easeOut);
}

export function overlayExiting(reduceMotion = false) {
  if (reduceMotion) return undefined;
  return FadeOut.duration(140).easing(easeOut);
}

export function sheetEntering(reduceMotion = false) {
  if (reduceMotion) return undefined;
  return SlideInDown.duration(pageDuration).easing(easeOut);
}

export function sheetExiting(reduceMotion = false) {
  if (reduceMotion) return undefined;
  return SlideOutDown.duration(sheetExitDuration).easing(easeOut);
}

export function listLayout(reduceMotion = false) {
  if (reduceMotion) return undefined;
  return LinearTransition.springify().damping(32).stiffness(420);
}

export function expandEntering(reduceMotion = false) {
  if (reduceMotion) return undefined;
  return FadeInDown.duration(overlayDuration).easing(easeOut);
}

export function expandExiting(reduceMotion = false) {
  if (reduceMotion) return undefined;
  return FadeOut.duration(140).easing(easeOut);
}
