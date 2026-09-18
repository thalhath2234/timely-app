import { type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export default function Screen({ children, padded = false }: { children: ReactNode; padded?: boolean }) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={[styles.body, padded && styles.padded]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, minHeight: 0, backgroundColor: colors.background },
  padded: { paddingHorizontal: 16 },
}));
