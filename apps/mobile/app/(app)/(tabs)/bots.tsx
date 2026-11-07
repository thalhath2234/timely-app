import { ScrollView } from "react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { SkeletonRows } from "../../../components/ui/motionKit";
import { useFabScrollInset } from "../../../components/ui/FloatingTabBar";
import { createThemedStyleSheet } from "../../../lib/theme";

/** The Bots tab. The board lands here next; until then it shows the loading shape. */
export default function BotsScreen() {
  const bottom = useFabScrollInset();
  return (
    <Screen>
      <MobileHeader title="Bots" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.body, { paddingBottom: bottom }]}
      >
        <SkeletonRows rows={4} height={64} />
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet(() => ({
  body: { paddingHorizontal: 16, paddingTop: 4 },
}));
