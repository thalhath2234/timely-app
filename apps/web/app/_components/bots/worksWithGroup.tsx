"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  BOT_LIMITS,
  filterLine,
  worksWith,
  type BotNames,
  type LinkInput,
  type LinkView,
} from "@timely/contract/bots";
import Button from "@/app/_components/_ui/button";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
  ListSubLabel,
  ListSwitch,
} from "@/app/_components/_ui/groupedList";
import { useToastStore } from "@/app/_store/toastStore";
import { useSetLink } from "@/app/utils/hooks/bots";

const HINT = `Passing hands what this bot finds to another bot, which checks it before you are told. ${BOT_LIMITS.maxLinks} bots at most, ${BOT_LIMITS.linkPerDay} items a day each.`;

/** A bot's saved Pass to links as inputs, oldest first (as the API lists them). */
export function passInputs(
  botId: string,
  links: LinkView[] | null | undefined,
): LinkInput[] {
  return (links ?? [])
    .filter((l) => l.kind === "pass" && l.fromBotId === botId)
    .map((l) => ({
      id: l.id,
      botId: l.toBotId,
      filter: [...l.filter],
      enabled: l.enabled,
    }));
}

/**
 * Works with, on a saved watch bot: the bots it passes its finds to (each
 * with its filter, today's count and an on/off switch, opening the link
 * page), the bots that pass to it, the briefs it is in, and Only in the
 * brief. Passes to rows follow the draft, so a link just added shows at once.
 */
export function WorksWithGroup({
  botId,
  passesTo,
  links,
  bots,
  briefOnly,
  onBriefOnly,
  onEdit,
  onAdd,
  canAdd,
  onOpenBot,
  reveal,
  error,
}: {
  botId: string;
  /** The draft's Pass to list. */
  passesTo: LinkInput[];
  /** Every saved link from or to this bot. */
  links: LinkView[] | null | undefined;
  bots: BotNames;
  briefOnly: boolean;
  onBriefOnly: (on: boolean) => void;
  onEdit: (index: number) => void;
  onAdd: () => void;
  /** Another watch bot is free to pass to. */
  canAdd: boolean;
  onOpenBot?: (id: string) => void;
  /** Scrolls the group into view as it appears (back from a link's page). */
  reveal?: boolean;
  error?: ReactNode;
}) {
  const setLink = useSetLink();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ block: "nearest" });
    // Only as it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saved = worksWith({ id: botId, briefOnly }, links, bots);
  const byId = new Map(saved.passesTo.map((p) => [p.link.id, p]));
  const toggle = (link: LinkView, enabled: boolean) =>
    setLink.mutate(
      { linkId: link.id, enabled, botId },
      { onError: (e) => useToastStore.getState().show(e.message) },
    );
  const busy = (link: LinkView) =>
    setLink.isPending && setLink.variables?.linkId === link.id;
  const nameOf = (id: string) => {
    if (Array.isArray(bots)) return bots.find((b) => b.id === id)?.name;
    return bots[id]?.name;
  };

  const rows: ReactNode[] = [
    <ListSubLabel key="to-label">Passes to</ListSubLabel>,
  ];
  passesTo.forEach((l, index) => {
    const view = l.id ? byId.get(l.id) : undefined;
    const name = nameOf(l.botId) ?? view?.name ?? "A deleted bot";
    const meta = [
      filterLine(l.filter),
      view ? view.passedLine : "Saving…",
    ].join(" · ");
    rows.push(
      <ListRow key={l.id ?? `new-${index}`} label={name} meta={meta}>
        <ListSwitch
          label={`Pass to ${name}`}
          checked={view ? view.link.enabled : (l.enabled ?? true)}
          disabled={!view || busy(view.link)}
          onChange={(next) => view && toggle(view.link, next)}
        />
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={`Edit pass to ${name}`}
          onClick={() => onEdit(index)}
        >
          <ChevronRight />
        </Button>
      </ListRow>,
    );
  });
  if (passesTo.length < BOT_LIMITS.maxLinks && canAdd) {
    rows.push(
      <ListRow
        key="add"
        label="Add a bot to pass to"
        tone="add"
        onClick={onAdd}
      />,
    );
  } else if (passesTo.length === 0) {
    rows.push(
      <ListRow
        key="none"
        label={<span className="text-muted-foreground">No bot to pass to</span>}
        meta="Make another bot that watches something first"
      />,
    );
  }

  if (saved.getsFrom.length) {
    rows.push(<ListSubLabel key="from-label">Gets items from</ListSubLabel>);
    for (const g of saved.getsFrom) {
      rows.push(
        <ListRow
          key={`from-${g.link.id}`}
          label={g.name}
          meta={`${filterLine(g.link.filter)} · Passed today ${g.link.passedToday} of ${BOT_LIMITS.linkPerDay}`}
        >
          <ListSwitch
            label={`Get items from ${g.name}`}
            checked={g.link.enabled}
            disabled={busy(g.link)}
            onChange={(next) => toggle(g.link, next)}
          />
        </ListRow>,
      );
    }
  }

  rows.push(<ListSubLabel key="brief-label">In brief</ListSubLabel>);
  for (const b of saved.inBriefs) {
    rows.push(
      <ListRow
        key={`brief-${b.link.id}`}
        label={b.name}
        meta={b.link.enabled ? "Sums up what this bot finds" : "Off"}
        onClick={onOpenBot ? () => onOpenBot(b.link.toBotId) : undefined}
      />,
    );
  }
  rows.push(
    <ListRow
      key="brief-only"
      label="Only in the brief"
      meta={
        saved.briefOnly.enabled
          ? "Its finds then go only into the brief, not to you."
          : "Add this bot to a brief first."
      }
    >
      <ListSwitch
        label="Only in the brief"
        checked={briefOnly}
        disabled={!saved.briefOnly.enabled && !briefOnly}
        onChange={onBriefOnly}
      />
    </ListRow>,
  );

  return (
    <section ref={ref} className="scroll-mt-5">
      <GroupLabel aside={`${passesTo.length} of ${BOT_LIMITS.maxLinks}`}>
        Works with
      </GroupLabel>
      <ListGroup>{rows}</ListGroup>
      {error ? (
        <GroupHint className="text-destructive">{error}</GroupHint>
      ) : null}
      <GroupHint>{HINT}</GroupHint>
    </section>
  );
}
