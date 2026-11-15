import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InstanceSettings } from "@timely/contract/instanceSettings";
import { api } from "../../lib/api/client";
import { Text, View } from "react-native";
import { CreditCard, Globe, Package, Send, Settings2, Trash2, type LucideIcon } from "lucide-react-native";
import {
  AUTO_ASKS_BEFORE,
  FULL_ACCESS_CONFIRM,
  FULL_ACCESS_PHONE_NOTE,
  PERMISSION_COPY,
  type AgentChatSettings,
  type FullAccessAllowedOn,
  type HostApprovalRule,
  type CriticalRow,
  type PermissionMode,
} from "@timely/contract/agentChat";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { usePatchAgentChatSettings } from "../../lib/hooks";
import { unlockDevice } from "../../lib/deviceUnlock";
import {
  AUTO_ASKS_HOST_NOTE,
  HOST_ALLOWED_ON_OPTIONS,
  HOST_RULE_OPTIONS,
  HOST_TIMEOUT_CHOICES,
  LOOSEN_ON_DESKTOP,
  ruleLabel,
  settingAccess,
  timeoutLabel,
} from "../../lib/chat/host";
import { permissionOptions } from "../../lib/chat/agentRun";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import { BlockedNote, PermissionBadge, PermissionModeRow } from "../chat/PermissionSheet";
import { Zap } from "lucide-react-native";
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
type Choice = "rule" | "timeout" | "allowedOn";

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
  // The note about commands on this computer is for an account that can use
  // it; chat-only accounts never get a host card.
  const computer = useQuery({
    queryKey: ["instance-settings"],
    queryFn: () => api<InstanceSettings>("/instance/settings"),
    retry: false,
    staleTime: 60_000,
  });
  const hostAllowed = !!computer.data?.thisAccountHostAllowed;
  const [picking, setPicking] = useState<Which | null>(null);
  const [choosing, setChoosing] = useState<Choice | null>(null);
  // Full Access asks once, naming what it lifts, then unlocks the phone (the step-up).
  const [confirm, setConfirm] = useState<Which | null>(null);
  const [note, setNote] = useState("");
  const rule: HostApprovalRule = settings.hostApprovalRule ?? "devices";
  const allowedOn = settings.fullAccessAllowedOn;
  // The phone is never the desktop window: loosening where Full Access or host
  // cards may be approved is the desktop app's (the server says 403 otherwise).
  const ruleLocked = !settingAccess("phone", "hostApprovalRule", "devices", allowedOn).allowed && rule === "desktop";
  const allowedLocked = !settingAccess("phone", "fullAccessAllowedOn", "devices", allowedOn).allowed && allowedOn === "desktop";
  const pick = (which: Which, mode: PermissionMode) => {
    setPicking(null);
    if (settings[which] === mode) return;
    if (mode === "full") return setConfirm(which);
    patch.mutate({ [which]: mode });
  };
  async function turnOnFull(which: Which) {
    setConfirm(null);
    setNote("");
    const unlocked = await unlockDevice();
    if (!unlocked.ok) return setNote(unlocked.message);
    patch.mutate({ [which]: "full", device: { kind: "phone", name: "Phone", unlocked: true } });
  }
  return (
    <View testID="agent-permissions" style={{ gap: 6 }}>
      <GroupLabel aside="Default for new runs">Permissions</GroupLabel>
      <ListGroup>
        <ListRow
          testID="permissions-chats"
          title="New chats"
          trailing={<PermissionBadge mode={settings.chatPermission} />}
          accessibilityLabel={`New chats start on ${PERMISSION_COPY[settings.chatPermission]?.name ?? settings.chatPermission}`}
          onPress={() => setPicking("chatPermission")}
        />
        <ListRow
          testID="permissions-bots"
          title="Bots"
          trailing={<PermissionBadge mode={settings.botPermission} />}
          accessibilityLabel={`Bots run on ${PERMISSION_COPY[settings.botPermission]?.name ?? settings.botPermission}`}
          onPress={() => setPicking("botPermission")}
        />
      </ListGroup>
      {patch.error ? (
        <Text style={styles.error}>{patch.error.message || "Could not save."}</Text>
      ) : (
        <GroupHint>Each chat can pick its own from the chip in its header. Changes that wait for you show in the chat.</GroupHint>
      )}

      <GroupLabel>Commands, files and browser</GroupLabel>
      <ListGroup testID="host-cards-settings">
        <ListRow
          testID="permissions-host-rule"
          title="Host cards"
          meta="Who can approve a card"
          trailing={ruleLabel(rule)}
          accessibilityLabel={`Host cards: ${ruleLabel(rule)}`}
          onPress={() => setChoosing("rule")}
        />
        <ListRow
          testID="permissions-host-timeout"
          title="Paused cards wait up to"
          meta="A card first waits 10 minutes with the reply paused on it. Then it waits this long more, and closes without running."
          trailing={timeoutLabel(settings.hostApprovalTimeoutMinutes)}
          accessibilityLabel={`Paused cards wait up to ${timeoutLabel(settings.hostApprovalTimeoutMinutes)}`}
          onPress={() => setChoosing("timeout")}
        />
      </ListGroup>
      <GroupHint>
        {ruleLocked ? `${LOOSEN_ON_DESKTOP}. ` : ""}
        {HOST_RULE_OPTIONS.find((o) => o.value === rule)?.hint}
        {rule === "desktop" ? "" : " Deny always works from any device."}
      </GroupHint>

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
      {hostAllowed ? <GroupHint>{AUTO_ASKS_HOST_NOTE}</GroupHint> : null}

      <GroupLabel>Full Access</GroupLabel>
      <ListGroup testID="full-access">
        <ListRow
          title="Turning it on"
          trailing={allowedOn === "devices" ? "Confirm, then unlock" : "Desktop app"}
          accessibilityLabel={allowedOn === "devices" ? "Turning it on asks for a confirmation and your phone's lock" : FULL_ACCESS_PHONE_NOTE}
        />
        <ListRow
          testID="permissions-allowed-on"
          title="Allowed on"
          meta={allowedLocked ? LOOSEN_ON_DESKTOP : undefined}
          trailing={HOST_ALLOWED_ON_OPTIONS.find((o) => o.value === allowedOn)?.label ?? "The desktop app"}
          accessibilityLabel={`Full Access allowed on ${allowedOn === "devices" ? "any of your devices" : "this desktop"}`}
          onPress={() => setChoosing("allowedOn")}
        />
      </ListGroup>
      {note ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {note}
        </Text>
      ) : null}
      <BlockedNote />

      <BottomSheet
        open={choosing !== null}
        onClose={() => setChoosing(null)}
        title={choosing === "rule" ? "Host cards" : choosing === "timeout" ? "Paused cards wait up to" : "Full Access allowed on"}
        subtitle={choosing === "rule" ? "Who can say Run once or Allow for this chat" : undefined}
      >
        <View style={styles.group}>
          {choosing === "rule"
            ? HOST_RULE_OPTIONS.map((o) => (
                <SheetOption
                  key={o.value}
                  selected={o.value === rule}
                  disabled={o.value === "devices" && ruleLocked}
                  detail={o.value === "devices" && ruleLocked ? LOOSEN_ON_DESKTOP : o.hint}
                  onSelect={() => {
                    setChoosing(null);
                    if (o.value !== rule) patch.mutate({ hostApprovalRule: o.value });
                  }}
                >
                  {o.label}
                </SheetOption>
              ))
            : choosing === "timeout"
              ? HOST_TIMEOUT_CHOICES.map((m) => (
                  <SheetOption
                    key={m}
                    selected={m === (settings.hostApprovalTimeoutMinutes ?? 60)}
                    onSelect={() => {
                      setChoosing(null);
                      patch.mutate({ hostApprovalTimeoutMinutes: m });
                    }}
                  >
                    {timeoutLabel(m)}
                  </SheetOption>
                ))
              : choosing === "allowedOn"
                ? HOST_ALLOWED_ON_OPTIONS.map((o) => (
                    <SheetOption
                      key={o.value}
                      selected={o.value === allowedOn}
                      disabled={o.value === "devices" && allowedLocked}
                      detail={o.value === "devices" && allowedLocked ? LOOSEN_ON_DESKTOP : undefined}
                      onSelect={() => {
                        setChoosing(null);
                        if (o.value !== allowedOn) patch.mutate({ fullAccessAllowedOn: o.value as FullAccessAllowedOn });
                      }}
                    >
                      {o.label}
                    </SheetOption>
                  ))
                : null}
        </View>
      </BottomSheet>
      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "botPermission" ? "Run bots on Full Access?" : "Start new chats on Full Access?"}
        message={FULL_ACCESS_CONFIRM.replace(/\s*Turn it on for this chat\?$/, "")}
        confirmLabel="Turn on"
        tone="primary"
        icon={<Zap size={16} color={colors.primaryForeground} />}
        onConfirm={() => {
          if (confirm) void turnOnFull(confirm);
        }}
      />

      <BottomSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        title={picking ? PICKER_TITLE[picking] : ""}
        subtitle="Chats and bots can change their own"
      >
        <View style={styles.group} accessibilityRole="radiogroup">
          {picking
            ? permissionOptions(settings[picking], allowedOn).map((option, index) => (
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
