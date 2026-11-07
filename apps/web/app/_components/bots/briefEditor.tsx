"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  BOT_LIMITS,
  BRIEF_TIMES,
  DEFAULT_BRIEF_TIME,
  type BotInput,
  type BotView,
  type BotsSummary,
} from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
  ListSwitch,
} from "@/app/_components/_ui/groupedList";
import Select from "@/app/_components/_ui/select";
import { useToastStore } from "@/app/_store/toastStore";
import { useBotIcons, useUpdateBot } from "@/app/utils/hooks/bots";
import type { EditHow } from "./botEditor";
import { BotMark, botSites } from "./botMark";
import { Pill } from "./countPill";

const isWatchBot = (b: Pick<BotView, "kind">) =>
  (b.kind ?? "watch") === "watch";

/**
 * A brief's own groups, in place of Watches, Schedule and Tells me when:
 * Sums up (the bots it gathers from, each with its Only in the brief switch
 * once saved, and Add a bot) and Sends (Daily at, Write it with AI).
 */
export function BriefEditor({
  draft,
  onChange,
  bots,
  saved,
  summary,
  error,
}: {
  draft: BotInput;
  onChange: (next: BotInput, how: EditHow) => void;
  /** The account's bots, for names and the Add a bot list. */
  bots: BotView[];
  /** The saved brief's sources: their switches act on the source bots. */
  saved?: string[];
  summary?: BotsSummary;
  error?: ReactNode;
}) {
  const update = useUpdateBot();
  const sources = useMemo(() => draft.sources ?? [], [draft.sources]);
  const byId = new Map(bots.map((b) => [b.id, b]));
  const sites = useMemo(() => {
    const ids = new Set(sources);
    return botSites(
      bots.filter((b) => ids.has(b.id)).flatMap((b) => b.watches),
    );
  }, [bots, sources]);
  const icons = useBotIcons(sites).data;
  const addable = bots.filter((b) => isWatchBot(b) && !sources.includes(b.id));
  const full = sources.length >= BOT_LIMITS.maxBriefSources;
  const setSources = (next: string[]) =>
    onChange({ ...draft, sources: next }, "now");
  // Undefined while the board loads: not the same as "no AI provider".
  const aiReady = summary?.ai.ready ?? true;
  const briefAi = !!draft.briefAi;
  // A time set in chat (07:30, 23:00) is not on the hourly list: it joins
  // it in order, so the row shows it and another pick can still change it.
  const time = draft.briefTime || DEFAULT_BRIEF_TIME;
  const times = BRIEF_TIMES.includes(time)
    ? BRIEF_TIMES
    : [...BRIEF_TIMES, time].sort();

  const setBriefOnly = (bot: BotView, briefOnly: boolean) =>
    update.mutate(
      { id: bot.id, patch: { briefOnly } },
      {
        onSuccess: () =>
          useToastStore
            .getState()
            .show(
              briefOnly
                ? `${bot.name} now tells you only through its briefs`
                : `${bot.name} tells you itself again`,
            ),
        onError: (e) => useToastStore.getState().show(e.message),
      },
    );

  const rows: ReactNode[] = sources.map((id) => {
    const bot = byId.get(id);
    const name = bot?.name ?? "A deleted bot";
    const live = !!bot && (saved ?? []).includes(id);
    return (
      <ListRow
        key={id}
        label={name}
        meta={
          !live
            ? "Added when the brief saves"
            : bot.briefOnly
              ? "Tells you only through its briefs"
              : "Also tells you itself"
        }
        icon={
          <BotMark
            watches={bot?.watches ?? []}
            size={24}
            icons={icons}
            badge={false}
          />
        }
      >
        {live ? (
          <span className="text-xs font-medium text-muted-foreground">
            Only in brief
          </span>
        ) : null}
        {live ? (
          <ListSwitch
            label={`Only in the brief: ${name}`}
            checked={bot.briefOnly}
            disabled={update.isPending && update.variables?.id === id}
            onChange={(next) => setBriefOnly(bot, next)}
          />
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={`Remove ${name}`}
          onClick={() => setSources(sources.filter((s) => s !== id))}
        >
          <X />
        </Button>
      </ListRow>
    );
  });
  if (!full && addable.length) {
    rows.push(
      <ListRow key="add" label="Add a bot" tone="add">
        <Select
          variant="row"
          aria-label="Add a bot"
          placeholder="Pick one"
          searchable={addable.length > 8}
          value=""
          options={addable.map((b) => ({ value: b.id, label: b.name }))}
          menuMinWidth={220}
          onChange={(id) => id && setSources([...sources, id])}
        />
      </ListRow>,
    );
  } else if (sources.length === 0) {
    rows.push(
      <ListRow
        key="none"
        label={
          <span className="text-muted-foreground">No bots to sum up yet</span>
        }
        meta="Make a bot that watches something first"
      />,
    );
  }

  return (
    <>
      <section>
        <GroupLabel
          aside={`${sources.length} of ${BOT_LIMITS.maxBriefSources}`}
        >
          Sums up
        </GroupLabel>
        <ListGroup>{rows}</ListGroup>
        {error ? (
          <GroupHint className="text-destructive">{error}</GroupHint>
        ) : null}
        <GroupHint>
          Each brief lists up to {BOT_LIMITS.briefItemsPerBot} new finds per
          bot, then “and N more”. Switch a bot to Only in the brief to hear
          about its finds here alone.
        </GroupHint>
      </section>
      <section>
        <GroupLabel>Sends</GroupLabel>
        <ListGroup>
          <ListRow label="Daily at">
            <Select
              variant="row"
              aria-label="Daily at"
              value={time}
              options={times.map((t) => ({ value: t, label: t }))}
              onChange={(briefTime) => onChange({ ...draft, briefTime }, "now")}
            />
          </ListRow>
          <ListRow label="Write it with AI">
            {!aiReady && !briefAi ? <Pill>Needs AI</Pill> : null}
            <ListSwitch
              label="Write it with AI"
              checked={briefAi}
              disabled={!aiReady && !briefAi}
              onChange={(next) => onChange({ ...draft, briefAi: next }, "now")}
            />
          </ListRow>
        </ListGroup>
        <GroupHint>
          One short AI call per brief; otherwise Timely lists the notes as they
          are.
          {!aiReady ? (
            <>
              {" "}
              Add an AI provider in{" "}
              <Link
                href="/settings?tab=agent"
                className="whitespace-nowrap font-medium text-primary hover:underline"
              >
                Settings › Agent
              </Link>
              .
            </>
          ) : null}
        </GroupHint>
      </section>
    </>
  );
}
