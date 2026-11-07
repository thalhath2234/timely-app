import { useState, type ReactElement } from "react";
import { View } from "react-native";
import { BOT_LIMITS, filterLine, worksWith, type BotView, type LinkInput, type LinkView } from "@timely/contract/bots";
import { GroupHint, GroupLabel, ListGroup, ListRow, ListSubLabel, ListSwitch } from "../settings/SettingsList";
import { useSetLink } from "../../lib/hooks";
import { useToastStore } from "../../lib/toast";
import { createThemedStyleSheet } from "../../lib/theme";
import { LinkPage } from "./LinkPage";

const HINT = `Passing hands what this bot finds to another bot, which checks it before you are told. ${BOT_LIMITS.maxLinks} bots at most, ${BOT_LIMITS.linkPerDay} items a day each.`;

const say = (message: string) => useToastStore.getState().show(message);

/** A bot's saved Pass to links as inputs, oldest first (as the API lists them). */
export function passInputs(botId: string, links: LinkView[] | null | undefined): LinkInput[] {
  return (links ?? [])
    .filter((l) => l.kind === "pass" && l.fromBotId === botId)
    .map((l) => ({ id: l.id, botId: l.toBotId, filter: [...l.filter], enabled: l.enabled }));
}

/**
 * A list to send as the bot's Pass to links. A link's switch saves on its
 * own route, so the list leaves each link's on/off out and the server keeps
 * what it has.
 */
const sendPasses = (list: LinkInput[]): LinkInput[] =>
  list.map((l) => (l.id ? { id: l.id, botId: l.botId, filter: l.filter } : { botId: l.botId, filter: l.filter }));

/**
 * Works with, on a saved watch bot (after its settings, before Lessons): the
 * bots it passes its finds to (each with its filter, today's count and an
 * on/off switch, opening the link's page), the bots that pass to it, the
 * briefs it is in, and Only in the brief. The same rows and words as the web.
 */
export function WorksWith({
  botId,
  passesTo,
  links,
  bots,
  briefOnly,
  onBriefOnly,
  onPasses,
  onOpenBot,
}: {
  botId: string;
  /** The draft's Pass to list. */
  passesTo: LinkInput[];
  /** Every saved link from or to this bot. */
  links: LinkView[] | null | undefined;
  /** The account's bots, for names and the bots it may pass to. */
  bots: Pick<BotView, "id" | "name" | "kind">[];
  briefOnly: boolean;
  onBriefOnly: (on: boolean) => void;
  /** Saves the bot's whole Pass to list; a refusal throws with the server's words. */
  onPasses: (list: LinkInput[]) => Promise<void>;
  /** Opens another bot (a brief this one is in). */
  onOpenBot: (id: string) => void;
}) {
  const setLink = useSetLink();
  const [editing, setEditing] = useState<{ index: number; link: LinkInput } | null>(null);
  const saved = worksWith({ id: botId, briefOnly }, links, bots);
  const byId = new Map(saved.passesTo.map((p) => [p.link.id, p]));
  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name;
  const linked = new Set(passesTo.map((l) => l.botId));
  const targetsFor = (current?: string) =>
    bots
      .filter((b) => (b.kind ?? "watch") === "watch" && b.id !== botId && (b.id === current || !linked.has(b.id)))
      .map((b) => ({ id: b.id, name: b.name }));
  const canAdd = targetsFor().length > 0;

  const toggle = (link: LinkView, enabled: boolean) =>
    setLink.mutate({ linkId: link.id, enabled }, { onError: (error) => say(error.message) });
  const busy = (link: LinkView) => setLink.isPending && setLink.variables?.linkId === link.id;

  const rows: ReactElement[] = [<ListSubLabel key="to-label">Passes to</ListSubLabel>];
  passesTo.forEach((l, index) => {
    const view = l.id ? byId.get(l.id) : undefined;
    const name = nameOf(l.botId) ?? view?.name ?? "A deleted bot";
    rows.push(
      <ListRow
        key={l.id ?? `new-${index}`}
        title={name}
        meta={`${filterLine(l.filter)} · ${view ? view.passedLine : "Saving…"}`}
        accessibilityLabel={`Edit pass to ${name}`}
        onPress={() => setEditing({ index, link: l })}
        action={
          <ListSwitch
            label={`Pass to ${name}`}
            value={view ? view.link.enabled : (l.enabled ?? true)}
            disabled={!view || busy(view.link)}
            onChange={(next) => view && toggle(view.link, next)}
          />
        }
      />,
    );
  });
  if (passesTo.length < BOT_LIMITS.maxLinks && canAdd) {
    rows.push(<ListRow key="add" title="Add a bot to pass to" tone="add" onPress={() => setEditing({ index: passesTo.length, link: { botId: "", filter: [] } })} />);
  } else if (passesTo.length === 0) {
    rows.push(<ListRow key="none" title="No bot to pass to" meta="Make another bot that watches something first" disabled />);
  }

  if (saved.getsFrom.length) {
    rows.push(<ListSubLabel key="from-label">Gets items from</ListSubLabel>);
    for (const g of saved.getsFrom) {
      rows.push(
        <ListRow
          key={`from-${g.link.id}`}
          title={g.name}
          meta={`${filterLine(g.link.filter)} · Passed today ${g.link.passedToday} of ${BOT_LIMITS.linkPerDay}`}
          trailing={<ListSwitch label={`Get items from ${g.name}`} value={g.link.enabled} disabled={busy(g.link)} onChange={(next) => toggle(g.link, next)} />}
        />,
      );
    }
  }

  rows.push(<ListSubLabel key="brief-label">In brief</ListSubLabel>);
  for (const b of saved.inBriefs) {
    rows.push(
      <ListRow
        key={`brief-${b.link.id}`}
        title={b.name}
        meta={b.link.enabled ? "Sums up what this bot finds" : "Off"}
        onPress={() => onOpenBot(b.link.toBotId)}
      />,
    );
  }
  rows.push(
    <ListRow
      key="brief-only"
      title="Only in the brief"
      meta={saved.briefOnly.enabled ? "Its finds then go only into the brief, not to you." : "Add this bot to a brief first."}
      trailing={<ListSwitch label="Only in the brief" value={briefOnly} disabled={!saved.briefOnly.enabled && !briefOnly} onChange={onBriefOnly} />}
    />,
  );

  const isNew = editing ? editing.index >= passesTo.length : false;
  return (
    <View style={styles.section}>
      <GroupLabel aside={`${passesTo.length} of ${BOT_LIMITS.maxLinks}`}>Works with</GroupLabel>
      <ListGroup>{rows}</ListGroup>
      <GroupHint>{HINT}</GroupHint>

      {editing ? (
        <LinkPage
          key={editing.index}
          link={editing.link}
          isNew={isNew}
          targets={targetsFor(editing.link.botId)}
          targetName={nameOf(editing.link.botId)}
          onClose={() => setEditing(null)}
          onSave={async (link) => {
            await onPasses(sendPasses(isNew ? [...passesTo, link] : passesTo.map((x, i) => (i === editing.index ? link : x))));
            setEditing(null);
          }}
          onRemove={async () => {
            await onPasses(sendPasses(passesTo.filter((_, i) => i !== editing.index)));
            setEditing(null);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  section: { gap: 6 },
}));
