"use client";

import { useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { Bot, X } from "lucide-react";
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
import { popoverSurface } from "@/app/_components/_ui/field";
import { PopoverView } from "@/app/_components/_ui/motion";
import { BotMark, botSites } from "@/app/_components/bots/botMark";
import type { BotTag } from "@/app/utils/api/chat";
import { cn } from "@/app/utils/cn";
import { useBotIcons, useBots } from "@/app/utils/hooks/bots";

/** Every name a tag in the text could be: the picked bots and the person's bots. */
function tagNames(tags: BotTag[], bots?: { name: string }[]): string[] {
  return [...tags, ...(bots ?? [])].map((b) => b.name);
}

/**
 * The picked bots the text still tags, read as the server reads it (so a
 * longer name that starts with a picked one is not that tag): only these are
 * sent as tags.
 */
export function liveBotTags(
  text: string,
  tags: BotTag[],
  bots?: { name: string }[],
): BotTag[] {
  const names = tagNames(tags, bots);
  return tags.filter((tag) => hasBotTag(text, tag.name, names));
}

/**
 * The composer's @-picker: typing "@" and part of a bot's name lists the
 * person's bots; picking one writes "@Name " into the message and tags the bot
 * for that message only. Arrow keys and Enter move within the open list, as in
 * the docs' mention menu; Escape closes it.
 */
export function useBotMention({
  text,
  setText,
  inputRef,
  tags,
  setTags,
  disabled,
}: {
  text: string;
  setText: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  tags: BotTag[];
  setTags: (tags: BotTag[]) => void;
  disabled?: boolean;
}) {
  const [caret, setCaret] = useState(text.length);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState({ query: "", index: 0 });
  const bots = useBots({ enabled: text.includes("@") }).data?.bots;
  const live = liveBotTags(text, tags, bots);
  const tag = disabled ? null : botTagQuery(text, caret);
  // The server tags what the text names as well as what was picked, so both
  // count toward the limit; the tag being typed is not one yet.
  const tagged = [
    ...new Set([
      ...live.map((t) => t.id),
      ...textBotTags(text, [...tags, ...(bots ?? [])], tag?.start).map(
        (b) => b.id,
      ),
    ]),
  ];
  const matches = tag ? botTagMatches(bots, tag.query, tagged) : [];
  const open = !!tag && dismissed !== tag.start && matches.length > 0;
  const full = tagged.length >= MAX_BOT_TAGS;
  const index =
    tag && active.query === tag.query
      ? Math.min(active.index, matches.length - 1)
      : 0;

  function pick(bot: BotView) {
    if (!tag || full) return;
    const next = insertBotTag(text, tag.start, caret, bot.name);
    setText(next.text);
    setTags([...live, { id: bot.id, name: bot.name }]);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      const box = inputRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(next.caret, next.caret);
    });
  }

  /** Keys while the list is open; true when the key was used. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open || !tag || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") {
      event.stopPropagation();
      setDismissed(tag.start);
      return true;
    }
    if (full) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : matches.length - 1;
      setActive({
        query: tag.query,
        index: (index + step) % matches.length,
      });
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      pick(matches[index]);
      return true;
    }
    return false;
  }

  return {
    tags: live,
    /** Keeps the caret, which the list follows. */
    onCaret: (box: HTMLTextAreaElement) => {
      setCaret(box.selectionStart ?? box.value.length);
      if (
        dismissed !== null &&
        botTagQuery(box.value, box.selectionStart)?.start !== dismissed
      )
        setDismissed(null);
    },
    onKeyDown,
    removeTag: (id: string) => {
      const gone = live.find((t) => t.id === id);
      if (gone) setText(removeBotTag(text, gone.name, tagNames(tags, bots)));
      setTags(live.filter((t) => t.id !== id));
    },
    picker: open ? (
      <BotMentionList
        bots={matches}
        active={index}
        full={full}
        onHover={(i) => tag && setActive({ query: tag.query, index: i })}
        onPick={pick}
      />
    ) : null,
  };
}

function BotMentionList({
  bots,
  active,
  full,
  onHover,
  onPick,
}: {
  bots: BotView[];
  active: number;
  full: boolean;
  onHover: (index: number) => void;
  onPick: (bot: BotView) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const icons = useBotIcons(botSites(bots.flatMap((b) => b.watches))).data;
  return (
    <PopoverView>
      <div
        role="listbox"
        aria-label="Tag a bot"
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          popoverSurface,
          "absolute bottom-full left-0 z-40 mb-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden p-1",
        )}
      >
        {full ? (
          <p
            role="status"
            className="px-2.5 py-2 text-[13px] font-medium text-muted-foreground"
          >
            Tag up to {MAX_BOT_TAGS} bots
          </p>
        ) : (
          bots.map((bot, i) => {
            const health = healthLine(bot, now);
            return (
              <button
                key={bot.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(bot)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                  i === active && "bg-muted",
                )}
              >
                <BotMark
                  watches={bot.watches}
                  size={24}
                  badge={false}
                  icons={icons}
                />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  {bot.name}
                </span>
                <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                  {health.word}
                </span>
              </button>
            );
          })
        )}
      </div>
    </PopoverView>
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
    <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Tagged bots">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-primary/20 bg-primary/8 py-0.5 pl-2 text-xs text-primary"
        >
          <Bot aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{tag.name}</span>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove tag ${tag.name}`}
            onClick={() => onRemove(tag.id)}
            className="rounded-r-md p-1 hover:bg-primary/15 disabled:opacity-40"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
