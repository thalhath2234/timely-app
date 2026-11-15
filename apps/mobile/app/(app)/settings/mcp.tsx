import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COMMAND_ONLY_DESKTOP, MCP_INTRO, MCP_SENDING_NOTE, MCP_TITLE } from "@timely/contract/agentMcp";
import Screen from "../../../components/ui/Screen";
import MobileHeader from "../../../components/ui/MobileHeader";
import { FocusGroupScrollView } from "../../../components/ui/FocusGroup";
import { PrimaryButton } from "../../../components/ui/primitives";
import { GroupHint, ListGroup, ListRow } from "../../../components/settings/SettingsList";
import { CatalogSheet, ServerRow, ServerSheet, useMcpServersQuery } from "../../../components/settings/McpParts";
import { createThemedStyleSheet } from "../../../lib/theme";

/** How long a sign-in is watched for after the browser opened (the server's own window is 15 minutes). */
const SIGN_IN_WATCH_MS = 3 * 60_000;

/**
 * Settings → Agent → MCP servers on the phone (phase 5, Q-5.6): the list, the mode of
 * each (Can use, Ask me first, Off), sign-in, tools and Remove, and adding a catalog
 * server that asks for nothing. An address with a sign-in key, and a command server,
 * are added in the desktop window.
 */
export default function McpServers() {
  const insets = useSafeAreaInsets();
  const [watching, setWatching] = useState<string | null>(null);
  const servers = useMcpServersQuery(watching);
  const [openName, setOpenName] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const list = servers.data?.servers ?? [];
  const open = list.find((s) => s.name === openName) ?? null;

  useEffect(() => {
    if (!watching) return;
    const timer = setTimeout(() => setWatching(null), SIGN_IN_WATCH_MS);
    return () => clearTimeout(timer);
  }, [watching]);

  return (
    <Screen>
      <MobileHeader title={MCP_TITLE} back large={false} />
      <FocusGroupScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom, gap: 8 }}>
        <Text style={styles.meta}>{MCP_INTRO}</Text>
        {servers.isLoading ? <Text style={styles.meta}>Checking…</Text> : null}
        {servers.error ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.error}>{servers.error.message || "Could not load your MCP servers."}</Text>
            <PrimaryButton label="Try again" onPress={() => void servers.refetch()} />
          </View>
        ) : null}
        {servers.data ? (
          <>
            <ListGroup testID="mcp-servers">
              {[
                ...list.map((s) => <ServerRow key={s.name} server={s} waiting={watching === s.name} onPress={() => setOpenName(s.name)} />),
                <ListRow key="add" tone="add" title="Add from the catalog" onPress={() => setCatalogOpen(true)} />,
              ]}
            </ListGroup>
            {note ? <Text style={styles.meta}>{note}</Text> : null}
            <GroupHint>{COMMAND_ONLY_DESKTOP}</GroupHint>
            {list.length > 0 ? <GroupHint>{MCP_SENDING_NOTE}</GroupHint> : null}
          </>
        ) : null}
      </FocusGroupScrollView>
      <ServerSheet server={open} onClose={() => setOpenName(null)} onSignInStarted={setWatching} />
      <CatalogSheet
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onAdded={(name, message, needsSignIn) => {
          setNote(message);
          if (needsSignIn) setOpenName(name);
        }}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  meta: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  error: { color: colors.destructive, fontSize: 13 },
}));
