import { useMemo, useState, type RefObject } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Bot, X } from "lucide-react-native";
import {
  MAX_BOT_TAGS,
  botTagMatches,
  botTagQuery,
  hasBotTag,
  healthLine,
  insertBotTag,
  removeBotTag,
  textBotTags,
  type BotView,
} from "@timely/contract/bots";
import type { BotTag } from "../../lib/chat/types";
import { useBotIcons, useBotsQuery } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { BotMark, botSites } from "../bots/BotMark";
import { ListGroup, ListRow } from "../settings/SettingsList";
import AnimatedPressable from "../ui/AnimatedPressable";

/** Every name a tag in the text could be: the picked bots and the person's bots. */
function tagNames(
  tags: BotTag[] | undefined,
  bots?: { name: string }[],
): string[] {
  return [...(tags ?? []), ...(bots ?? [])].map((b) => b.name);
}

/**
 * The picked bots the text still tags, read as the server reads it (so a
 * longer name that starts with a picked one is not that tag): only these are
 * sent as tags.
 */
export function liveBotTags(
  text: string,
  tags: BotTag[] | undefined,
  bots?: { name: string }[],
): BotTag[] {
  const names = tagNames(tags, bots);
  return (tags ?? []).filter((tag) => hasBotTag(text, tag.name, names));
}

/** A TextInput that can move its caret (native), or its DOM node (web). */
type Caret = TextInput & {
  setSelection?: (start: number, end: number) => void;
  setSelectionRange?: (start: number, end: number) => void;
};

/**
 * The composer's @-picker: typing "@" and part of a bot's name lists the
 * person's bots above the message box; picking one writes "@Name " into the
 * message and tags the bot for that message only.
 */
export function useBotMention({
  text,
  tags,
  onTag,
  inputRef,
  disabled,
}: {
  text: string;
  tags: BotTag[] | undefined;
  /** The new text and tags together, so the draft changes once. */
  onTag: (text: string, tags: BotTag[]) => void;
  inputRef: RefObject<TextInput | null>;
  disabled?: boolean;
}) {
  const [caret, setCaret] = useState(text.length);
  const bots = useBotsQuery().data?.bots;
  const live = liveBotTags(text, tags, bots);
  const tag = disabled ? null : botTagQuery(text, caret);
  // The server tags what the text names as well as what was picked, so both
  // count toward the limit; the tag being typed is not one yet.
  const tagged = [
    ...new Set([
      ...live.map((t) => t.id),
      ...textBotTags(text, [...(tags ?? []), ...(bots ?? [])], tag?.start).map(
        (b) => b.id,
      ),
    ]),
  ];
  const matches = tag ? botTagMatches(bots, tag.query, tagged) : [];
  const full = tagged.length >= MAX_BOT_TAGS;

  function pick(bot: BotView) {
    if (!tag || full) return;
    const next = insertBotTag(text, tag.start, caret, bot.name);
    onTag(next.text, [...live, { id: bot.id, name: bot.name }]);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const box = inputRef.current as Caret | null;
      box?.focus();
      if (box?.setSelection) box.setSelection(next.caret, next.caret);
      else box?.setSelectionRange?.(next.caret, next.caret);
    });
  }

  return {
    tags: live,
    /** Typing at the end keeps the caret at the end; elsewhere the selection event moves it. */
    onTextChange: (value: string) => {
      if (caret >= text.length) setCaret(value.length);
    },
    onSelectionChange: (start: number) => setCaret(start),
    removeTag: (id: string) => {
      const gone = live.find((t) => t.id === id);
      onTag(
        gone ? removeBotTag(text, gone.name, tagNames(tags, bots)) : text,
        live.filter((t) => t.id !== id),
      );
    },
    picker:
      tag && matches.length ? (
        <BotMentionList bots={matches} full={full} onPick={pick} />
      ) : null,
  };
}

function BotMentionList({
  bots,
  full,
  onPick,
}: {
  bots: BotView[];
  full: boolean;
  onPick: (bot: BotView) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const icons = useBotIcons(botSites(bots.flatMap((b) => b.watches))).data;
  return (
    <View style={styles.wrap} accessibilityLabel="Tag a bot">
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ListGroup>
          {full ? (
            <ListRow
              title={`Tag up to ${MAX_BOT_TAGS} bots`}
              meta="Remove a tag to add another."
            />
          ) : (
            bots.map((bot) => (
              <ListRow
                key={bot.id}
                title={bot.name}
                meta={healthLine(bot, now).word}
                accessibilityLabel={`Tag ${bot.name}`}
                leading={
                  <BotMark
                    watches={bot.watches}
                    size={28}
                    badge={false}
                    icons={icons}
                  />
                }
                chevron={false}
                onPress={() => onPick(bot)}
              />
            ))
          )}
        </ListGroup>
      </ScrollView>
    </View>
  );
}

/** The bots tagged in the message being written, each removable. */
export function BotTagChips({
  tags,
  disabled,
  onRemove,
}: {
  tags: BotTag[];
  disabled: boolean;
  onRemove: (id: string) => void;
}) {
  if (!tags.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 6, paddingHorizontal: 12 }}
      accessibilityLabel="Tagged bots"
    >
      {tags.map((tag) => (
        <View key={tag.id} style={styles.chip}>
          <Bot size={12} color={colors.accentForeground} />
          <Text numberOfLines={1} style={styles.chipText}>
            {tag.name}
          </Text>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={`Remove tag ${tag.name}`}
            hitSlop={8}
            disabled={disabled}
            onPress={() => onRemove(tag.id)}
            style={[styles.chipRemove, disabled && { opacity: 0.4 }]}
          >
            <X size={12} color={colors.accentForeground} />
          </AnimatedPressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = createThemedStyleSheet(() => ({
  wrap: { paddingHorizontal: 12 },
  scroll: { maxHeight: 232 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 220,
    borderRadius: 10,
    backgroundColor: colors.accent,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
  },
  chipText: {
    color: colors.accentForeground,
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
  chipRemove: { padding: 4, borderRadius: 8 },
}));
