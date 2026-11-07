import { useState } from "react";
import { Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import { BOT_LIMITS, type LinkInput } from "@timely/contract/bots";
import BottomSheet from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import { PrimaryButton, Select } from "../ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../settings/SettingsList";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { FieldRow } from "./rows";

/** A bot a link can pass to. */
export type LinkTarget = { id: string; name: string };

/** "2TB NVMe, 4TB" as the filter words it holds. */
const wordsOf = (text: string) =>
  text
    .split(",")
    .map((w) => w.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/**
 * One Pass to link on its own page of the bot sheet, as a watch is: the bot
 * it passes to and the words a find must mention. Save hands the link back
 * and the sheet saves the bot's whole list; a refusal stays on the page. An
 * existing link can be removed after a confirm. Same words as the web.
 */
export function LinkPage({
  link: initial,
  isNew,
  targets,
  targetName,
  onSave,
  onRemove,
  onClose,
}: {
  link: LinkInput;
  isNew: boolean;
  /** The bots it may pass to: watch bots, not this one, not one it already passes to. */
  targets: LinkTarget[];
  /** The saved target's name, shown even when it is no longer listed. */
  targetName?: string;
  /** Resolves once saved; a refusal throws with the server's words. */
  onSave: (link: LinkInput) => Promise<void>;
  onRemove?: () => Promise<void>;
  onClose: () => void;
}) {
  const [botId, setBotId] = useState(initial.botId);
  const [text, setText] = useState(initial.filter.join(", "));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const words = wordsOf(text);
  const dirty = botId !== initial.botId || JSON.stringify(words) !== JSON.stringify(initial.filter);

  const options = targets.map((t) => ({ value: t.id, label: t.name }));
  if (botId && !options.some((o) => o.value === botId)) {
    options.unshift({ value: botId, label: targetName ?? "A deleted bot" });
  }
  const name = options.find((o) => o.value === botId)?.label;
  const problem = !botId
    ? targets.length
      ? "Pick the bot that checks what this one finds"
      : "Make another bot that watches something first"
    : words.length > BOT_LIMITS.maxFilterWords
      ? `Up to ${BOT_LIMITS.maxFilterWords} filter words`
      : null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setRefused(null);
    try {
      await action();
    } catch (error) {
      setRefused(error instanceof Error ? error.message : "That didn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    // Another bot makes a new link: the old one's id and switch stay with it.
    run(() => onSave(botId === initial.botId ? { ...initial, botId, filter: words } : { botId, filter: words }));

  const line = refused ?? problem ?? "This bot stays quiet about what it passes on.";
  return (
    <BottomSheet
      open
      onClose={onClose}
      title={isNew ? "Pass to a bot" : "Edit pass"}
      footer={<PrimaryButton label={isNew ? "Add" : "Save"} disabled={!!problem || (!isNew && !dirty)} loading={busy} onPress={() => void save()} />}
    >
      <View style={styles.body}>
        <View style={styles.section}>
          <GroupLabel>Passes to</GroupLabel>
          <ListGroup>
            <Select
              trigger="row"
              label="Bot"
              meta="It checks each find under its own rules and limits"
              placeholder="Pick a bot"
              searchable={options.length > 8}
              value={botId}
              options={options}
              onChange={(id) => {
                setBotId(id);
                setRefused(null);
              }}
            />
            <FieldRow
              title="Only when it mentions"
              value={text}
              placeholder="e.g. 2TB NVMe"
              autoCapitalize="none"
              width={140}
              onChangeText={(next) => {
                setText(next);
                setRefused(null);
              }}
            />
          </ListGroup>
          <GroupHint>Leave empty to pass on everything. Separate words with commas.</GroupHint>
          <GroupHint>
            {name
              ? `${name} checks ${words.length ? `finds that mention ${words.join(" or ")}` : "everything this bot finds"} before you are told. `
              : ""}
            Up to {BOT_LIMITS.linkPerDay} items a day; more wait for the next brief.
          </GroupHint>
          <Text style={refused || (problem && botId) ? styles.error : styles.muted}>{line}</Text>
        </View>
        {!isNew ? (
          <ListGroup>
            <ListRow title="Remove" tone="danger" leading={<Trash2 size={18} color={colors.destructive} />} disabled={busy} onPress={() => setConfirming(true)} />
          </ListGroup>
        ) : null}
      </View>
      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Stop passing to ${targetName ?? name ?? "this bot"}?`}
        message="What this bot finds comes to you again, under its own rules."
        confirmLabel="Remove"
        onConfirm={() => run(() => onRemove?.() ?? Promise.resolve())}
      />
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { gap: 16, paddingTop: 4 },
  section: { gap: 6 },
  muted: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
  error: { color: colors.destructive, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
}));
