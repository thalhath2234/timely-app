import { useState } from "react";
import { Text, View } from "react-native";
import { CreditCard, Globe, Package, Send, Settings2, Trash2, type LucideIcon } from "lucide-react-native";
import {
  AUTO_ASKS_BEFORE,
  FULL_ACCESS_PHONE_NOTE,
  type AgentChatSettings,
  type CriticalRow,
  type PermissionMode,
} from "@timely/contract/agentChat";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { usePatchAgentChatSettings } from "../../lib/hooks";
import { permissionOptions } from "../../lib/chat/agentRun";
import BottomSheet from "../ui/BottomSheet";
import { BlockedNote, PermissionBadge, PermissionModeRow } from "../chat/PermissionSheet";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "./SettingsList";

/** The drawn glyph of each "Auto always asks before" row. */
const CRITICAL_ICONS: Record<CriticalRow["item"], LucideIcon> = {
  1: Trash2,
  2: Send,
  3: CreditCard,
  4: Package,
  5: Settings2,
  6: Globe,
};

type Which = "chatPermission" | "botPermission";

const PICKER_TITLE: Record<Which, string> = {
  chatPermission: "New chats",
  botPermission: "Bots",
};

/**
 * Settings → Agent → Permissions (Option1Permissions.dc.html, on the phone):
 * the modes new chats and bots start on, what Auto always asks before, and
 * Full Access, which the phone shows but can't turn on in phase 2.
 */
export default function PermissionsCard({ settings }: { settings: AgentChatSettings }) {
  const patch = usePatchAgentChatSettings();
  const [picking, setPicking] = useState<Which | null>(null);
  const pick = (which: Which, mode: PermissionMode) => {
    setPicking(null);
    if (settings[which] !== mode) patch.mutate({ [which]: mode });
  };
  return (
    <View testID="agent-permissions" style={{ gap: 6 }}>
      <GroupLabel aside="Default for new runs">Permissions</GroupLabel>
      <ListGroup>
        <ListRow
          testID="permissions-chats"
          title="New chats"
          trailing={<PermissionBadge mode={settings.chatPermission} />}
          accessibilityLabel={`New chats start on ${settings.chatPermission}`}
          onPress={() => setPicking("chatPermission")}
        />
        <ListRow
          testID="permissions-bots"
          title="Bots"
          trailing={<PermissionBadge mode={settings.botPermission} />}
          accessibilityLabel={`Bots run on ${settings.botPermission}`}
          onPress={() => setPicking("botPermission")}
        />
      </ListGroup>
      {patch.error ? (
        <Text style={styles.error}>{patch.error.message || "Could not save."}</Text>
      ) : (
        <GroupHint>Each chat can pick its own from the chip in its header. Changes that wait for you show in the chat.</GroupHint>
      )}

      <GroupLabel>Auto always asks before</GroupLabel>
      <ListGroup testID="auto-asks-before">
        {AUTO_ASKS_BEFORE.map((row) => {
          const Icon = CRITICAL_ICONS[row.item];
          return (
            <ListRow
              key={row.item}
              title={row.title}
              meta={row.detail}
              leading={<Icon size={17} color={colors.mutedForeground} />}
            />
          );
        })}
      </ListGroup>

      <GroupLabel>Full Access</GroupLabel>
      <ListGroup testID="full-access">
        <ListRow title="Turning it on" trailing="Desktop app" accessibilityLabel={FULL_ACCESS_PHONE_NOTE} />
        <ListRow
          title="Allowed on"
          trailing={settings.fullAccessAllowedOn === "devices" ? "All your devices" : "The desktop app"}
        />
      </ListGroup>
      <GroupHint>Full Access works like Auto for now: the changes Auto asks about still ask.</GroupHint>
      <BlockedNote />

      <BottomSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        title={picking ? PICKER_TITLE[picking] : ""}
        subtitle="Chats and bots can change their own"
      >
        <View style={styles.group} accessibilityRole="radiogroup">
          {picking
            ? permissionOptions(settings[picking]).map((option, index) => (
                <View key={option.mode}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <PermissionModeRow {...option} onPress={() => pick(picking, option.mode)} />
                </View>
              ))
            : null}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  group: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  divider: { height: 1, backgroundColor: colors.border },
  error: { color: colors.destructive, fontSize: 12, marginHorizontal: 4 },
}));
