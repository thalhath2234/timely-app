import { ActivityIndicator, Text, View } from "react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export default function StartupLoader() {
  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <ActivityIndicator accessibilityLabel="Preparing Timely" color={colors.primary} size="large" />
      <Text style={styles.label}>Preparing Timely</Text>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: colors.background,
  },
  label: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
}));
