import { useEffect } from "react";
import { router, useLocalSearchParams } from "expo-router";
import StartupLoader from "../../../components/ui/StartupLoader";
import { requestQuickAdd } from "../../../lib/quickAddIntent";

/**
 * Where launcher shortcuts (long-press the app icon) and widget buttons land:
 * timelymobile://shortcut/<action>. Swaps itself for Home, then opens the
 * thing asked for, so Back from it leaves the app as the launcher expects.
 */
export default function ShortcutScreen() {
  const { action } = useLocalSearchParams<{ action?: string }>();

  useEffect(() => {
    router.replace("/(app)/(tabs)/home");
    switch (action) {
      case "new-task":
        requestQuickAdd({ kind: "task" });
        break;
      case "capture":
        requestQuickAdd({ kind: "inbox" });
        break;
      case "ask":
        router.push("/(app)/assistant");
        break;
      case "search":
        router.push("/(app)/search");
        break;
    }
  }, [action]);

  return <StartupLoader />;
}
