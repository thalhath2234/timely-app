import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Network from "expo-network";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { flushOfflineQueue } from "../lib/api/client";
import { queuedMutationCount, subscribeQueuedMutations } from "../lib/offlineQueue";
import { setOffline } from "../lib/networkState";
import { useServer } from "../lib/server/ServerProvider";
import { createThemedStyleSheet } from "../lib/theme";

export default function ConnectivityBanner() {
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const server = useServer();
  const [networkOffline, setNetworkOffline] = useState(false);
  // An unreachable desktop counts as offline too: changes queue instead of
  // failing, and queries wait instead of spinning until the server answers.
  const serverDown = server.status === "offline";
  const offline = networkOffline || serverDown;
  const [queued, setQueued] = useState(queuedMutationCount());
  const [syncing, setSyncing] = useState(false);
  const wasOffline = useRef(false);
  const replaying = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => subscribeQueuedMutations(setQueued), []);

  // Replay whatever is waiting as soon as the account is known and the device
  // is online: after a restart the queue is read back from disk, so the first
  // network reading is "online" and the reconnect path below never runs. A
  // replay that leaves items behind does not start another until the queue or
  // connectivity changes again.
  useEffect(() => {
    if (offline || queued === 0 || replaying.current) return;
    let mounted = true;
    replaying.current = true;
    setSyncing(true);
    void (async () => {
      try {
        await flushOfflineQueue();
        await queryClient.invalidateQueries();
      } finally {
        replaying.current = false;
        if (mounted) setSyncing(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [offline, queued, queryClient]);

  useEffect(() => {
    let mounted = true;
    const apply = (state: Network.NetworkState) => {
      if (mounted) setNetworkOffline(state.isConnected === false);
    };
    void Network.getNetworkStateAsync().then(apply);
    const subscription = Network.addNetworkStateListener(apply);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setOffline(offline);
    onlineManager.setOnline(!offline);
    if (offline) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setSyncing(true);
    void (async () => {
      try {
        await flushOfflineQueue();
        await queryClient.invalidateQueries();
      } finally {
        if (mountedRef.current) setSyncing(false);
      }
    })();
  }, [offline, queryClient]);

  if (!offline && !syncing && queued === 0) return null;
  const waiting = queued ? ` · ${queued} change${queued === 1 ? "" : "s"} waiting` : "";
  const label = networkOffline
    ? `Offline · saved data may be out of date${waiting}`
    : serverDown
      ? server.wrongServer.length > 0
        ? `${server.name || "Your desktop"}'s address answers as a different server · pair again in Settings`
        : `Can't reach ${server.name || "your desktop"} · is Tailscale on?${waiting}`
    : syncing
      ? "Back online · syncing changes…"
      : `${queued} change${queued === 1 ? "" : "s"} waiting to sync`;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 6 }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.banner, offline ? styles.offline : styles.syncing]}
      >
        <Text style={styles.text}>{label}</Text>
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 40,
    elevation: 40,
    alignItems: "center",
  },
  banner: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    maxWidth: "100%",
  },
  offline: { backgroundColor: colors.warning },
  syncing: { backgroundColor: colors.primary },
  text: { color: "#171717", fontSize: 12, fontWeight: "600", textAlign: "center" },
}));
