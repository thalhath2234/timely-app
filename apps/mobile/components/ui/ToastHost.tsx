import { Pressable, StyleSheet, Text, View } from "react-native";
import { useToastStore } from "../../lib/toast";
import { colors } from "../../lib/theme";

export default function ToastHost() {
  const message = useToastStore((state) => state.message);
  const action = useToastStore((state) => state.action);
  const hide = useToastStore((state) => state.hide);
  if (!message) return null;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.card}>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, bottom: 96 },
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
});
