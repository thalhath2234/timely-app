import { Text, View } from "react-native";
import TimelyLogo from "./TimelyLogo";
import { createThemedStyleSheet } from "../../lib/theme";

export default function StartupLoader() {
  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      accessibilityLabel="Preparing Timely"
    >
      <TimelyLogo size={64} animated />
      <Text style={styles.label}>Preparing Timely</Text>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    backgroundColor: colors.background,
  },
  label: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
}));
