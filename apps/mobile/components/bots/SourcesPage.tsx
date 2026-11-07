import { useState } from "react";
import { Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { BOT_LIMITS, type BotView } from "@timely/contract/bots";
import BottomSheet from "../ui/BottomSheet";
import { PrimaryButton } from "../ui/primitives";
import { GroupHint, ListGroup, ListRow } from "../settings/SettingsList";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { BotMark, type SiteIcons } from "./BotMark";

/**
 * The bots a brief sums up, picked on their own page of the bot sheet: every
 * bot that watches something, ticked when it is in the brief, up to 8. Save
 * hands the list back in the brief's order (new ones at the end); a refusal
 * stays on the page.
 */
export function SourcesPage({
  sources,
  bots,
  icons,
  unsaved,
  onSave,
  onClose,
}: {
  sources: string[];
  /** The account's watch bots. */
  bots: Pick<BotView, "id" | "name" | "watches" | "kind">[];
  icons?: SiteIcons;
  /** A new brief: the list goes into the draft, not to the server. */
  unsaved?: boolean;
  /** Resolves once saved; a refusal throws with the server's words. */
  onSave: (sources: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(sources);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const full = picked.length >= BOT_LIMITS.maxBriefSources;
  const changed = JSON.stringify(picked) !== JSON.stringify(sources);
  const toggle = (id: string) => {
    setRefused(null);
    setPicked((was) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]));
  };
  const save = async () => {
    setBusy(true);
    setRefused(null);
    try {
      await onSave(picked);
    } catch (error) {
      setRefused(error instanceof Error ? error.message : "That didn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Sums up"
      subtitle={`${picked.length} of ${BOT_LIMITS.maxBriefSources}`}
      footer={<PrimaryButton label={unsaved ? "Done" : "Save"} disabled={!changed} loading={busy} onPress={() => void save()} />}
    >
      <View style={styles.body}>
        {bots.length ? (
          <ListGroup>
            {bots.map((b) => {
              const on = picked.includes(b.id);
              return (
                <ListRow
                  key={b.id}
                  title={b.name}
                  leading={<BotMark watches={b.watches} kind={b.kind} size={24} icons={icons} badge={false} />}
                  trailing={on ? <Check size={18} color={colors.primary} strokeWidth={2.5} /> : undefined}
                  accessibilityLabel={on ? `${b.name}, in the brief` : b.name}
                  chevron={false}
                  disabled={!on && full}
                  onPress={() => toggle(b.id)}
                />
              );
            })}
          </ListGroup>
        ) : (
          <GroupHint>No bots to sum up yet. Make a bot that watches something first.</GroupHint>
        )}
        <GroupHint>
          {full
            ? `A brief sums up ${BOT_LIMITS.maxBriefSources} bots at most. Untick one to pick another.`
            : `Pick up to ${BOT_LIMITS.maxBriefSources} bots. Each brief lists up to ${BOT_LIMITS.briefItemsPerBot} new finds per bot.`}
        </GroupHint>
        {refused ? <Text style={styles.error}>{refused}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { gap: 8, paddingTop: 4, paddingBottom: 8 },
  error: { color: colors.destructive, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
}));
