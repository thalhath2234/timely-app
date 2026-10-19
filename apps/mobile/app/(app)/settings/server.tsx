import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RefreshCw } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../../../components/settings/SettingsList";
import ConfirmSheet from "../../../components/ui/ConfirmSheet";
import { useServer, type ServerStatus } from "../../../lib/server/ServerProvider";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

function statusLabel(status: ServerStatus, health: { status: string; db?: string } | null) {
  if (status === "checking") return "Checking…";
  if (status === "online") return health?.status === "ok" ? "Online" : "Online · database degraded";
  if (status === "offline") return "Unreachable";
  return "Not reachable";
}

function statusTone(status: ServerStatus, health: { status: string } | null) {
  if (status === "online") return health?.status === "ok" ? colors.success : colors.warning;
  if (status === "offline") return colors.destructive;
  return colors.mutedForeground;
}

function formatChecked(at: number | null) {
  if (!at) return "Not yet";
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ServerSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const server = useServer();
  const [confirmChange, setConfirmChange] = useState(false);
  const checking = server.status === "checking";
  const others = (server.config?.urls ?? []).filter((url) => url !== server.activeUrl);

  return (
    <Screen>
      <MobileHeader title="Server" back large={false} />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom, gap: 18 }}>
        <View style={styles.section}>
          <GroupLabel>Current server</GroupLabel>
          <ListGroup>
            <ListRow title="Name" trailing={server.name || "Timely desktop"} />
            <ListRow title="Address" meta={server.activeUrl || "—"} />
            <ListRow
              title="Status"
              trailing={<Text numberOfLines={1} style={[styles.value, { color: statusTone(server.status, server.health) }]}>{statusLabel(server.status, server.health)}</Text>}
            />
            {server.health?.db && server.health.status !== "ok" ? (
              <ListRow title="Database" trailing={<Text numberOfLines={1} style={[styles.value, { color: colors.warning }]}>{server.health.db}</Text>} />
            ) : null}
            <ListRow title="Version" trailing={server.health?.version ?? "—"} />
            {server.health?.migrations ? (
              <ListRow
                title="Schema"
                trailing={
                  server.health.migrations.pending > 0
                    ? `${server.health.migrations.version} · ${server.health.migrations.pending} pending`
                    : String(server.health.migrations.version)
                }
              />
            ) : null}
            <ListRow title="Checked" trailing={formatChecked(server.lastCheckedAt)} />
            <ListRow
              tone="add"
              leading={<RefreshCw size={16} color={colors.primary} />}
              title={checking ? "Checking…" : "Check again"}
              disabled={checking}
              onPress={() => void server.check()}
            />
          </ListGroup>
          <GroupHint>
            This phone talks to the Timely desktop over Tailscale. Every launch re-checks the known addresses and keeps
            using the first one that answers.
          </GroupHint>
        </View>

        <View style={styles.section}>
          <GroupLabel aside={others.length ? String(others.length) : undefined}>Other known addresses</GroupLabel>
          {others.length === 0 ? (
            <GroupHint>None. The desktop's QR code lists its Tailscale address and loopback address.</GroupHint>
          ) : (
            <>
              <ListGroup>
                {others.map((url) => (
                  <ListRow key={url} title={url} />
                ))}
              </ListGroup>
              <GroupHint>Tried in order when the current address stops answering.</GroupHint>
            </>
          )}
        </View>

        <View style={styles.section}>
          <ListGroup>
            <ListRow tone="danger" title="Change server…" onPress={() => setConfirmChange(true)} />
          </ListGroup>
          <GroupHint>
            Sign-in tokens belong to one server, so pairing with a different computer signs you out of this one first.
          </GroupHint>
        </View>
      </ScrollView>
      <ConfirmSheet
        open={confirmChange}
        onClose={() => setConfirmChange(false)}
        title="Change server?"
        message={`You'll be signed out of ${server.name || server.activeUrl || "this server"} once the new one answers. Nothing changes if the new address cannot be reached.`}
        confirmLabel="Continue"
        onConfirm={() => router.push("/connect?mode=change")}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  section: { gap: 6 },
  value: { maxWidth: 190, color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
}));
