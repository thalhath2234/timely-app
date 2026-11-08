import { Text, View } from "react-native";
import { Bell, Bot, Monitor, Plus, ShieldCheck } from "lucide-react-native";
import { DEFAULT_BOT_SETTINGS, STARTERS, type BotSettings, type StarterId } from "@timely/contract/bots";
import EmptyState from "../ui/EmptyState";
import ListEnter from "../ui/ListEnter";
import { SkeletonRows } from "../ui/motionKit";
import { Button } from "../ui/primitives";
import { GroupHint, GroupLabel, ListGroup, SwitchRow } from "../settings/SettingsList";
import { useBotDefaultsQuery, useSetBotDefaults } from "../../lib/hooks";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { StarterCard } from "./Starters";

// The web's three facts, worded for the phone: checks run in Timely on the
// computer the phone is paired with, not on the phone.
const FACTS = [
  {
    icon: Monitor,
    title: "Runs on your computer",
    sub: "Checks run in Timely on your computer, even from the tray, and catch up when it’s back.",
  },
  {
    icon: Bell,
    title: "Quiet by default",
    sub: "A rule tells you once when it becomes true. At most 3 alerts a day.",
  },
  {
    icon: ShieldCheck,
    title: "Reads, never acts",
    sub: "It reads pages, feeds and prices. It never buys, posts or deletes. Bots made by outside apps, like Claude Code, start paused until you turn them on.",
  },
];

/** "Alerts for new bots": where a bot made from now on tells the person. */
function AlertDefaults() {
  const defaults = useBotDefaultsQuery();
  const save = useSetBotDefaults();
  if (!defaults.data) {
    if (defaults.isError) return <GroupHint>Couldn’t load where new bots alert. Pull down to try again.</GroupHint>;
    return <SkeletonRows rows={3} />;
  }
  // Each save sends the whole object, built on the stored values.
  const current: BotSettings = save.isPending && save.variables ? save.variables : (defaults.data ?? DEFAULT_BOT_SETTINGS);
  const set = (patch: Partial<BotSettings>) =>
    save.mutate({ ...current, ...patch }, { onError: (error) => useToastStore.getState().show(error.message) });
  return (
    <ListGroup>
      <SwitchRow title="Desktop" value={current.desktop} onChange={(desktop) => set({ desktop })} />
      <SwitchRow title="Phone" value={current.phone} onChange={(phone) => set({ phone })} />
      <SwitchRow title="Urgent" meta="Rings through quiet hours" value={current.urgent} onChange={(urgent) => set({ urgent })} />
    </ListGroup>
  );
}

/**
 * The Bots tab before the first bot: what a bot does above a film loop and
 * New bot, the starters, where new bots alert, and how bots behave.
 */
export function BotsEmpty({
  onNew,
  onStarter,
  onChat,
}: {
  onNew: () => void;
  onStarter: (id: StarterId) => void;
  onChat: (text: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      <EmptyState
        icon={Bot}
        loop="bots"
        title="Let a bot keep an eye on it"
        description="A bot checks a page, a feed or a price on its own schedule and tells you only when something changed."
        action={
          <View style={styles.action}>
            <Button label="New bot" icon={<Plus size={16} color={colors.primaryForeground} />} onPress={onNew} />
            <Text style={styles.hint}>Opens a blank editor. It works without any AI set up.</Text>
          </View>
        }
      />

      <View style={styles.section}>
        <GroupLabel>Starters</GroupLabel>
        {STARTERS.map((starter, index) => (
          <ListEnter key={starter.id} index={index}>
            <StarterCard starter={starter} onUse={onStarter} onChat={onChat} />
          </ListEnter>
        ))}
        <GroupHint>Each opens the editor with the words filled in.</GroupHint>
      </View>

      <View style={styles.section}>
        <GroupLabel>Alerts for new bots</GroupLabel>
        <AlertDefaults />
        <GroupHint>Where a new bot tells you. Change any bot later.</GroupHint>
      </View>

      <View style={styles.section}>
        <GroupLabel>How bots behave</GroupLabel>
        <ListGroup>
          {FACTS.map(({ icon: Icon, title, sub }) => (
            <View key={title} style={styles.fact}>
              <View style={styles.factTile}>
                <Icon size={14} color={colors.mutedForeground} />
              </View>
              <View style={styles.factText}>
                <Text style={styles.factTitle}>{title}</Text>
                <Text style={styles.factSub}>{sub}</Text>
              </View>
            </View>
          ))}
        </ListGroup>
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { gap: 16 },
  action: { gap: 8, alignItems: "flex-start" },
  hint: { color: colors.mutedForeground, fontSize: 12 },
  section: { gap: 8 },
  fact: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  factTile: { width: 28, height: 28, borderRadius: 10, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  factText: { flex: 1, minWidth: 0, gap: 2 },
  factTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  factSub: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
}));
