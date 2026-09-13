import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Network from "expo-network";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { flushOfflineQueue } from "../lib/api/client";
import { queuedMutationCount, subscribeQueuedMutations } from "../lib/offlineQueue";
import { setOffline } from "../lib/networkState";
import { colors } from "../lib/theme";

export default function ConnectivityBanner() {
  const queryClient = useQueryClient();
  const [offline, setOfflineView] = useState(false);
  const [queued, setQueued] = useState(queuedMutationCount());
  const [syncing, setSyncing] = useState(false);

  useEffect(() => subscribeQueuedMutations(setQueued), []);

  useEffect(() => {
    let mounted = true;
    const apply = async (state: Network.NetworkState) => {
      const nextOffline = state.isConnected === false || state.isInternetReachable === false;
      setOffline(nextOffline);
      onlineManager.setOnline(!nextOffline);
      if (mounted) setOfflineView(nextOffline);
      if (!nextOffline) {
        setSyncing(true);
        try {
          await flushOfflineQueue();
          await queryClient.invalidateQueries();
        } finally {
          if (mounted) setSyncing(false);
        }
      }
    };
    void Network.getNetworkStateAsync().then(apply);
    const subscription = Network.addNetworkStateListener((state) => void apply(state));
    return () => { mounted = false; subscription.remove(); };
  }, [queryClient]);

  if (!offline && !syncing && queued === 0) return null;
  const label = offline
    ? `Offline · saved data may be out of date${queued ? ` · ${queued} change${queued === 1 ? "" : "s"} waiting` : ""}`
    : syncing ? "Back online · syncing changes…" : `${queued} change${queued === 1 ? "" : "s"} waiting to sync`;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.banner, offline ? styles.offline : styles.syncing]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: 12, paddingVertical: 7, alignItems: "center" },
  offline: { backgroundColor: colors.warning },
  syncing: { backgroundColor: colors.primary },
  text: { color: "#171717", fontSize: 12, fontWeight: "600", textAlign: "center" },
});
