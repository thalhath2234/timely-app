import { Pressable, StyleSheet, Text } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { useToastStore } from "../../lib/toast";
import { toastEntering, toastExiting } from "../../lib/motion";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export default function ToastHost() {
  const message = useToastStore((state) => state.message);
  const action = useToastStore((state) => state.action);
  const hide = useToastStore((state) => state.hide);
  const reduceMotion = useReducedMotion();
  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      entering={toastEntering(reduceMotion)}
      exiting={toastExiting(reduceMotion)}
      style={styles.wrap}
    >
      <Animated.View style={styles.card}>
        <Text style={styles.message}>{message}</Text>
        {action ? (
          <Pressable
            onPress={() => {
              action.onAction();
              hide();
            }}
          >
            <Text style={styles.action}>{action.label}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { position: "absolute", left: 12, right: 12, bottom: 96, zIndex: 1000, elevation: 1000 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  message: { flex: 1, color: colors.foreground, fontSize: 14 },
  action: { color: colors.primary, fontWeight: "700" },
}));
