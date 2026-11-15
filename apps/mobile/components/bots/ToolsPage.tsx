import { useState } from "react";
import { Text, View } from "react-native";
import { Plus, X } from "lucide-react-native";
import type { AgentBotTools, McpMode } from "@timely/contract/bots";
import AnimatedPressable from "../ui/AnimatedPressable";
import SegmentedControl from "../ui/SegmentedControl";
import { Field } from "../ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../settings/SettingsList";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { MCP_MODE_WORDS, cleanSite } from "./agentBot";
import { SavePage } from "./SavePage";

const MODES: McpMode[] = ["use", "ask", "off"];

/** A list of hosts with a remove button each and an add field under it. */
function HostList({
  title,
  hint,
  hosts,
  onChange,
  placeholder,
  max,
}: {
  title: string;
  hint: string;
  hosts: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  max: number;
}) {
  const [typed, setTyped] = useState("");
  const host = cleanSite(typed);
  const add = () => {
    if (!host || hosts.includes(host) || hosts.length >= max) return;
    onChange([...hosts, host]);
    setTyped("");
  };
  return (
    <View style={styles.block}>
      <GroupLabel aside={hosts.length ? String(hosts.length) : undefined}>{title}</GroupLabel>
      {hosts.length ? (
        <ListGroup>
          {hosts.map((h) => (
            <ListRow
              key={h}
              title={h}
              chevron={false}
              trailing={
                <AnimatedPressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${h}`}
                  hitSlop={8}
                  onPress={() => onChange(hosts.filter((x) => x !== h))}
                >
                  <X size={18} color={colors.mutedForeground} />
                </AnimatedPressable>
              }
            />
          ))}
        </ListGroup>
      ) : null}
      <View style={styles.addRow}>
        <View style={{ flex: 1 }}>
          <Field value={typed} onChangeText={setTyped} placeholder={placeholder} keyboardType="url" accessibilityLabel={`Add to ${title}`} />
        </View>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${title}`}
          disabled={!host || hosts.length >= max}
          onPress={add}
          style={[styles.add, (!host || hosts.length >= max) && styles.addOff]}
        >
          <Plus size={20} color={colors.primaryForeground} />
        </AnimatedPressable>
      </View>
      <GroupHint>{hint}</GroupHint>
    </View>
  );
}

/**
 * What the Bot may reach: sites it reads on your signed-in browser (reading
 * one runs alone; typing, a submit or another site waits in Needs you), extra
 * hosts its web tools may call, and how each outside app is used. Memory and
 * About you is its own switch on the Bot page. It is saved untouched here.
 */
export function ToolsPage({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: AgentBotTools | undefined;
  onSave: (tools: AgentBotTools) => Promise<void>;
  onClose: () => void;
}) {
  const [tools, setTools] = useState<AgentBotTools>({
    browserSites: initial?.browserSites ?? [],
    egress: initial?.egress ?? [],
    useMemory: initial?.useMemory ?? false,
    mcp: initial?.mcp ?? {},
  });
  const [touched, setTouched] = useState(false);
  const set = (patch: Partial<AgentBotTools>) => {
    setTools((now) => ({ ...now, ...patch }));
    setTouched(true);
  };
  const servers = Object.keys(tools.mcp);
  return (
    <SavePage open={open} title="Tools" canSave={touched} onSave={() => onSave(tools)} onClose={onClose}>
      <HostList
        title="Signed-in sites"
        hint="It reads these on your own browser, signed in as you. Anything else there waits for your OK."
        hosts={tools.browserSites}
        onChange={(browserSites) => set({ browserSites })}
        placeholder="example.com"
        max={10}
      />
      <HostList
        title="Extra hosts"
        hint="Besides the sites it reads, its web tools may reach only these."
        hosts={tools.egress}
        onChange={(egress) => set({ egress })}
        placeholder="api.example.com"
        max={20}
      />
      {servers.length ? (
        <View style={styles.block}>
          <GroupLabel>Apps</GroupLabel>
          <ListGroup>
            {servers.map((name) => (
              <View key={name} style={styles.mcp}>
                <Text numberOfLines={1} style={styles.mcpName}>
                  {name}
                </Text>
                <SegmentedControl
                  size="sm"
                  accessibilityLabel={`${name} mode`}
                  value={tools.mcp[name]}
                  onChange={(mode: McpMode) => set({ mcp: { ...tools.mcp, [name]: mode } })}
                  options={MODES.map((mode) => ({ value: mode, label: MCP_MODE_WORDS[mode] }))}
                />
              </View>
            ))}
          </ListGroup>
          <GroupHint>After it reads something from the web, an app can only read.</GroupHint>
        </View>
      ) : null}
    </SavePage>
  );
}

const styles = createThemedStyleSheet(() => ({
  block: { gap: 8 },
  addRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  add: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  addOff: { opacity: 0.4 },
  mcp: { minHeight: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  mcpName: { flex: 1, color: colors.foreground, fontSize: 15 },
}));
