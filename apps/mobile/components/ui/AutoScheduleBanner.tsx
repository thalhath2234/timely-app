import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Sparkles, X } from "lucide-react-native";
import { useScheduleActivity } from "../../lib/scheduleActivity";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export default function AutoScheduleBanner() {
  const { status, message, dismiss } = useScheduleActivity();

  useEffect(() => {
    if (status !== "done" && status !== "error") return;
    const timer = setTimeout(dismiss, 4500);
    return () => clearTimeout(timer);
  }, [status, dismiss]);

  if (status === "idle" || !message) return null;

  return (
    <View style={[styles.banner, status === "error" && styles.error]}>
      <Sparkles size={16} color={status === "error" ? colors.destructive : colors.primary} />
      <Text style={[styles.text, status === "error" && { color: colors.destructive }]}>{message}</Text>
      {status === "running" ? (
        <View style={styles.spinner} />
      ) : (
        <Pressable onPress={dismiss} hitSlop={8}>
          <X size={14} color={colors.mutedForeground} />
        </Pressable>
      )}
    </View>
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
  spinner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.mutedForeground,
    borderTopColor: colors.primary,
  },
}));
