import { Platform } from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";

/** Bottom inset that still works on OEMs where SafeArea reports 0. */
export function systemBottomInset(insetBottom = 0) {
  const metrics = initialWindowMetrics?.insets.bottom ?? 0;
  return Math.max(insetBottom, metrics, Platform.OS === "android" ? 24 : 16);
}
