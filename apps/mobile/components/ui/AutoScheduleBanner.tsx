import { useEffect } from "react";
import { Pressable, Text } from "react-native";
import { Sparkles, X } from "lucide-react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { useScheduleActivity } from "../../lib/scheduleActivity";
import { toastEntering, toastExiting } from "../../lib/motion";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { LogoSpinner } from "./TimelyLogo";

export default function AutoScheduleBanner() {
  const { status, message, dismiss } = useScheduleActivity();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (status !== "done" && status !== "error") return;
    const timer = setTimeout(dismiss, 4500);
    return () => clearTimeout(timer);
  }, [status, dismiss]);

  if (status === "idle" || !message) return null;

  return (
    <Animated.View
      entering={toastEntering(reduceMotion)}
      exiting={toastExiting(reduceMotion)}
      style={[styles.banner, status === "error" && styles.error]}
    >
      <Sparkles size={16} color={status === "error" ? colors.destructive : colors.primary} />
      <Text style={[styles.text, status === "error" && { color: colors.destructive }]}>{message}</Text>
      {status === "running" ? (
        <LogoSpinner size={16} />
      ) : (
        <Pressable onPress={dismiss} hitSlop={8}>
          <X size={14} color={colors.mutedForeground} />
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  banner: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 88,
    zIndex: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  error: { borderColor: colors.destructive },
  text: { flex: 1, color: colors.cardForeground, fontSize: 13 },
}));
