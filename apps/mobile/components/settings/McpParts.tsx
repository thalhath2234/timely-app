import { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug } from "lucide-react-native";
import {
  MCP_MODES,
  MCP_TITLE,
  SIGN_IN_NOTE,
  addedMessage,
  catalogCategories,
  filterCatalog,
  modeLabel,
  serverStatus,
  serverTarget,
  serversSummary,
  toolAlwaysAsks,
  toolClassLabel,
  type McpCatalogRow,
  type McpMode,
  type McpServer,
} from "@timely/contract/agentMcp";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import {
  addMcpServer,
  getMcpCatalog,
  getMcpServers,
  getMcpTools,
  removeMcpServer,
  startMcpSignIn,
  updateMcpServer,
} from "../../lib/api/agentMcp";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import { Button } from "../ui/primitives";
import { ListGroup, ListRow } from "./SettingsList";

export const MCP_ROUTE = "/(app)/settings/mcp";
const mcpKey = ["agent-mcp"] as const;

/** While a sign-in waits, the list is read every 3 seconds; the screen stops watching after 3 minutes. */
export function useMcpServersQuery(watching: string | null = null) {
  return useQuery({
    queryKey: [...mcpKey, "servers"],
    queryFn: getMcpServers,
    staleTime: 15_000,
    refetchInterval: (query) => (watching && !query.state.data?.servers.find((s) => s.name === watching)?.signedIn ? 3000 : false),
  });
}

export function useMcpCatalogQuery(enabled: boolean) {
  return useQuery({ queryKey: [...mcpKey, "catalog"], queryFn: getMcpCatalog, enabled, staleTime: 10 * 60_000, retry: false });
}

export function useMcpToolsQuery(server: string, enabled: boolean) {
  return useQuery({ queryKey: [...mcpKey, "tools", server], queryFn: () => getMcpTools(server), enabled, staleTime: 60_000, retry: false });
}

function useRefreshing<TArg, TOut>(fn: (arg: TArg) => Promise<TOut>) {
  const cache = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void cache.invalidateQueries({ queryKey: mcpKey }) });
}

export const useSetMcpMode = () => useRefreshing(({ name, mode }: { name: string; mode: McpMode }) => updateMcpServer(name, { mode }));
export const useRemoveMcp = () => useRefreshing((name: string) => removeMcpServer(name));
export const useAddMcp = () => useRefreshing((catalogId: string) => addMcpServer({ catalogId }));

/** Settings → Agent: "MCP servers" with how many and what needs you, opening the screen. */
export function McpRow() {
  const servers = useMcpServersQuery();
  const router = useRouter();
  if (servers.isError) return null; // an older server without /agent/mcp shows no row
  return (
    <ListGroup testID="mcp-row">
      <ListRow
        title={MCP_TITLE}
        meta={servers.data ? serversSummary(servers.data.servers) : "Checking…"}
        leading={
          <View style={styles.tile}>
            <Plug size={16} color={colors.primary} />
          </View>
        }
        onPress={() => router.push(MCP_ROUTE)}
      />
    </ListGroup>
  );
}

function ModeBadge({ mode }: { mode: McpMode }) {
  const tone = mode === "use" ? colors.primary : mode === "off" ? colors.mutedForeground : colors.successText;
  return <Text style={[styles.badge, { color: tone }]}>{modeLabel(mode)}</Text>;
}

/** One server as a row; the status is the second line. */
export function ServerRow({ server, waiting, onPress }: { server: McpServer; waiting: boolean; onPress: () => void }) {
  const status = serverStatus(server);
  const line = waiting && !server.signedIn ? "Waiting for the sign-in…" : status.text;
  return (
    <ListRow
      testID={`mcp-server-${server.name}`}
      title={server.name}
      meta={[serverTarget(server), server.flag, line].filter(Boolean).join("\n")}
      trailing={<ModeBadge mode={server.mode} />}
      accessibilityLabel={`${server.name}, ${modeLabel(server.mode)}, ${line}`}
      onPress={onPress}
    />
  );
}

/** The sheet of one server: its mode, sign-in, tools and Remove. */
export function ServerSheet({
  server,
  onClose,
  onSignInStarted,
}: {
  server: McpServer | null;
  onClose: () => void;
  onSignInStarted: (name: string) => void;
}) {
  const setMode = useSetMcpMode();
  const remove = useRemoveMcp();
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const tools = useMcpToolsQuery(server?.name ?? "", !!server && server.mode !== "off" && server.status !== "unavailable" && server.status !== "waiting_for_ok");
  // The server row changes under the sheet (a mode, a sign-in): the sheet reads the live one.
  const status = server ? serverStatus(server) : null;

  useEffect(() => setError(null), [server?.name]);

  async function signIn() {
    if (!server) return;
    setSigningIn(true);
    setError(null);
    try {
      const url = await startMcpSignIn(server.name);
      onSignInStarted(server.name);
      await Linking.openURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the sign-in.");
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <>
      <BottomSheet open={server !== null && !confirming} onClose={onClose} title={server?.name ?? ""} subtitle={server ? serverTarget(server) : undefined}>
        {server ? (
          <View style={{ gap: 12 }}>
            {server.description ? <Text style={styles.meta}>{server.description}</Text> : null}
            {server.flag ? <Text style={styles.warn}>{server.flag}. Its sending and deleting tools always ask in Auto.</Text> : null}
            <View style={styles.group} accessibilityRole="radiogroup">
              {MCP_MODES.map((m, index) => (
                <View key={m.value}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <AnimatedPressable
                    testID={`mcp-mode-${m.value}`}
                    accessibilityRole="radio"
                    accessibilityLabel={`${m.label}, ${m.hint}`}
                    accessibilityState={{ checked: server.mode === m.value, disabled: setMode.isPending }}
                    disabled={setMode.isPending}
                    onPress={() => {
                      if (server.mode !== m.value) setMode.mutate({ name: server.name, mode: m.value });
                    }}
                    style={[styles.mode, server.mode === m.value && { backgroundColor: `${colors.primary}14` }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modeName}>{m.label}</Text>
                      <Text style={styles.modeLine}>{m.hint}</Text>
                    </View>
                    <View style={[styles.radio, server.mode === m.value && styles.radioOn]} />
                  </AnimatedPressable>
                </View>
              ))}
            </View>
            {setMode.error ? <Text style={styles.error}>{setMode.error.message}</Text> : null}
            {status ? <Text style={status.tone === "error" ? styles.error : status.tone === "warn" ? styles.warn : styles.meta}>{status.text}</Text> : null}
            {server.signsIn && server.mode !== "off" ? (
              <View style={{ gap: 6 }}>
                <Button
                  testID="mcp-sign-in"
                  label={server.signedIn ? "Sign in again" : "Sign in"}
                  variant={server.signedIn ? "outline" : "primary"}
                  loading={signingIn}
                  onPress={() => void signIn()}
                />
                <Text style={styles.meta}>{SIGN_IN_NOTE}</Text>
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Tools</Text>
              {tools.isFetching && !tools.data ? (
                <Text style={styles.meta}>Asking the server…</Text>
              ) : tools.error ? (
                <Text style={styles.error}>{tools.error.message}</Text>
              ) : tools.data?.error ? (
                <Text style={styles.meta}>{tools.data.needsSignIn ? "Sign in to see this server's tools." : tools.data.error}</Text>
              ) : (tools.data?.tools ?? []).length === 0 ? (
                <Text style={styles.meta}>{server.mode === "off" ? "Turn it on to see its tools." : "No tools listed."}</Text>
              ) : (
                (tools.data?.tools ?? []).map((tool) => (
                  <View key={tool.name} style={styles.tool}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.toolName}>{tool.name}</Text>
                      {tool.description ? (
                        <Text numberOfLines={2} style={styles.meta}>
                          {tool.description}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.tag, toolAlwaysAsks(tool.class) && { color: colors.warningText }]}>{toolClassLabel(tool.class)}</Text>
                  </View>
                ))
              )}
            </View>
            <Button testID="mcp-remove" label="Remove" variant="destructive-ghost" onPress={() => setConfirming(true)} />
          </View>
        ) : null}
      </BottomSheet>
      <ConfirmSheet
        open={server !== null && confirming}
        onClose={() => setConfirming(false)}
        title={server ? `Remove ${server.name}?` : ""}
        message="The assistant can no longer use it, and its saved sign-in is deleted. Your account on that service is untouched."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!server) return;
          await remove.mutateAsync(server.name);
          setConfirming(false);
          onClose();
        }}
      />
    </>
  );
}

/** The catalog on the phone: a search, a category, and Add for a server that asks for nothing. */
export function CatalogSheet({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (name: string, message: string, needsSignIn: boolean) => void;
}) {
  const catalog = useMcpCatalogQuery(open);
  const add = useAddMcp();
  const [category, setCategory] = useState("");
  const rows = catalog.data ?? [];
  const shown = filterCatalog(rows, "", category);
  const [error, setError] = useState<string | null>(null);

  async function addRow(row: McpCatalogRow) {
    setError(null);
    try {
      const out = await add.mutateAsync(row.id);
      onAdded(out.server.name, addedMessage(out.server.name, out.pending), out.server.status === "needs_sign_in");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the server.");
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Add from the catalog" subtitle="Each one starts on Ask me first">
      <View style={{ gap: 10 }}>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {[{ value: "", label: "All" }, ...catalogCategories(rows)].map((c) => (
            <AnimatedPressable
              key={c.value || "all"}
              accessibilityRole="radio"
              accessibilityLabel={c.label}
              accessibilityState={{ checked: category === c.value }}
              onPress={() => setCategory(c.value)}
              style={[styles.chip, category === c.value && { backgroundColor: `${colors.primary}1a`, borderColor: `${colors.primary}66` }]}
            >
              <Text style={[styles.chipText, category === c.value && { color: colors.primary }]}>{c.label}</Text>
            </AnimatedPressable>
          ))}
        </View>
        {catalog.isPending ? <Text style={styles.meta}>Asking the assistant for the catalog…</Text> : null}
        {catalog.error ? <Text style={styles.error}>{catalog.error.message}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <ListGroup>
          {shown.map((row) => (
            <ListRow
              key={row.id}
              testID={`mcp-catalog-${row.id}`}
              title={row.name}
              meta={[row.flag, row.fields.length > 0 ? "Set up from Timely on the web or the desktop app" : "", row.description].filter(Boolean).join("\n")}
              trailing={row.added ? <Text style={styles.tag}>Added</Text> : row.fields.length > 0 ? undefined : <Text style={[styles.badge, { color: colors.primary }]}>Add</Text>}
              chevron={false}
              disabled={add.isPending}
              onPress={row.added || row.fields.length > 0 ? undefined : () => void addRow(row)}
              accessibilityLabel={`${row.name}, ${row.added ? "added" : row.fields.length > 0 ? "set up from Timely on the web or the desktop app" : "add"}`}
            />
          ))}
        </ListGroup>
      </View>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: `${colors.primary}1a` },
  badge: { fontSize: 13, fontWeight: "600" },
  tag: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  warn: { color: colors.warningText, fontSize: 13, lineHeight: 18 },
  error: { color: colors.destructive, fontSize: 13, lineHeight: 18 },
  label: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  group: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" },
  divider: { height: 1, backgroundColor: colors.border },
  mode: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  modeName: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  modeLine: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16, marginTop: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  tool: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  toolName: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: "center", backgroundColor: colors.card },
  chipText: { color: colors.foreground, fontSize: 13, fontWeight: "500" },
}));

