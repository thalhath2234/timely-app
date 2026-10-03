import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RefreshCw } from "lucide-react-native";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { PropertyGroup, PropertyRow, SectionLabel } from "../../../components/ui/primitives";
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
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom, gap: 12 }}>
        <Text style={styles.help}>
          This phone talks to the Timely desktop below over Tailscale. Every launch re-checks the known
          addresses and keeps using the first one that answers.
        </Text>

        <SectionLabel>Current server</SectionLabel>
        <PropertyGroup tone="card">
          <PropertyRow label="Name" value={server.name || "Timely desktop"} />
          <PropertyRow label="Address" value={server.activeUrl || "—"} />
          <PropertyRow
            label="Status"
            value={statusLabel(server.status, server.health)}
            tone={statusTone(server.status, server.health)}
          />
          {server.health?.db && server.health.status !== "ok" ? (
            <PropertyRow label="Database" value={server.health.db} tone={colors.warning} />
          ) : null}
          <PropertyRow label="Version" value={server.health?.version ?? "—"} />
          {server.health?.migrations ? (
            <PropertyRow
              label="Schema"
              value={
                server.health.migrations.pending > 0
                  ? `${server.health.migrations.version} · ${server.health.migrations.pending} pending`
                  : String(server.health.migrations.version)
              }
            />
          ) : null}
          <PropertyRow label="Checked" value={formatChecked(server.lastCheckedAt)} />
        </PropertyGroup>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Check again"
          disabled={checking}
          onPress={() => void server.check()}
          style={[styles.secondary, checking && { opacity: 0.4 }]}
        >
          <RefreshCw size={16} color={colors.foreground} />
          <Text style={styles.secondaryText}>{checking ? "Checking…" : "Check again"}</Text>
        </AnimatedPressable>

        <SectionLabel>Other known addresses</SectionLabel>
        {others.length === 0 ? (
          <Text style={styles.help}>None. The desktop's QR code lists its Tailscale address and loopback address.</Text>
        ) : (
          <View style={styles.list}>
            {others.map((url) => (
              <Text key={url} style={styles.listItem} selectable>
                {url}
              </Text>
            ))}
            <Text style={styles.help}>Tried in order when the current address stops answering.</Text>
          </View>
        )}

        <SectionLabel>Change server</SectionLabel>
        <Text style={styles.help}>
          Sign-in tokens belong to one server, so pairing with a different computer signs you out of this
          one first.
        </Text>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Change server"
          onPress={() => setConfirmChange(true)}
          style={styles.danger}
        >
          <Text style={styles.dangerText}>Change server…</Text>
        </AnimatedPressable>
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
  help: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  secondary: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryText: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  list: { gap: 8 },
  listItem: {
    color: colors.foreground,
    fontSize: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  danger: { alignItems: "center", paddingVertical: 14 },
  dangerText: { color: colors.destructive, fontWeight: "600", fontSize: 15 },
}));
