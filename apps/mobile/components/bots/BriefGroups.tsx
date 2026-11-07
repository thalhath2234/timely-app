import { useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { Sparkles, X } from "lucide-react-native";
import {
  BOT_LIMITS,
  BRIEF_TIMES,
  DEFAULT_BRIEF_TIME,
  agoLabel,
  type BotDetail,
  type BotInput,
  type BotView,
  type BotsSummary,
} from "@timely/contract/bots";
import { Button, Select } from "../ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow, ListSwitch } from "../settings/SettingsList";
import { useBotIcons, useUpdateBot } from "../../lib/hooks";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { AlertFeedback } from "./AlertFeedback";
import { AlertsGroup, type Commit } from "./BotGroups";
import { BotMark, botSites } from "./BotMark";
import { CheckStrip } from "./CheckStrip";
import { Pill } from "./Pill";
import { SourcesPage } from "./SourcesPage";

const say = (message: string) => useToastStore.getState().show(message);

const isWatchBot = (b: Pick<BotView, "kind">) => (b.kind ?? "watch") === "watch";

/** Marks in the Last brief card's row of runs, as the watch cards draw theirs. */
const STRIP_MARKS = 16;

/**
 * A brief's own groups, in place of Watches, Schedule and Tells me when, on
 * an open brief and a new one: Sums up (the bots it gathers from, each with
 * its Only in the brief switch once saved, and Add a bot), Sends (Daily at,
 * Write it with AI) and Alerts. Lessons and Delete follow in the sheet, so
 * the order matches the web editor.
 */
export function BriefGroups({
  draft,
  bots,
  saved,
  summary,
  unsaved = false,
  onCommit,
  onSetUpAi,
}: {
  draft: BotInput;
  /** The account's bots, for names and the bots it may sum up. */
  bots: BotView[];
  /** The saved brief's sources: their switches act on the source bots. */
  saved?: string[];
  /** Undefined while the board loads: not the same as "no AI provider". */
  summary?: Pick<BotsSummary, "ai">;
  /** A new brief: nothing is saved until Create. */
  unsaved?: boolean;
  onCommit: Commit;
  /** Opens Settings › Agent, where an AI provider is added. */
  onSetUpAi?: () => void;
}) {
  const update = useUpdateBot();
  const [picking, setPicking] = useState(false);
  const sources = useMemo(() => draft.sources ?? [], [draft.sources]);
  const byId = new Map(bots.map((b) => [b.id, b]));
  const watchBots = useMemo(() => bots.filter(isWatchBot), [bots]);
  const sites = useMemo(() => botSites(watchBots.flatMap((b) => b.watches)), [watchBots]);
  const icons = useBotIcons(sites).data;
  const aiReady = summary?.ai.ready ?? true;
  const briefAi = !!draft.briefAi;
  // A time set in chat (07:30, 23:00) is not on the hourly list: it joins it
  // in order, so the row shows it and another pick can still change it.
  const time = draft.briefTime || DEFAULT_BRIEF_TIME;
  const times = BRIEF_TIMES.includes(time) ? BRIEF_TIMES : [...BRIEF_TIMES, time].sort();

  const setBriefOnly = (bot: BotView, briefOnly: boolean) =>
    update.mutate(
      { id: bot.id, patch: { briefOnly } },
      {
        onSuccess: () => say(briefOnly ? `${bot.name} now tells you only through its briefs` : `${bot.name} tells you itself again`),
        onError: (error) => say(error.message),
      },
    );

  const rows: ReactElement[] = sources.map((id) => {
    const bot = byId.get(id);
    const name = bot?.name ?? "A deleted bot";
    const live = !!bot && !unsaved && (saved ?? []).includes(id);
    return (
      <ListRow
        key={id}
        title={name}
        // The switch is Only in the brief; its row says so, with its state.
        meta={!live ? "Added when the brief saves" : bot.briefOnly ? "Only in the brief: on" : "Only in the brief: off"}
        leading={<BotMark watches={bot?.watches ?? []} size={24} icons={icons} badge={false} />}
        trailing={
          <View style={styles.controls}>
            {live ? (
              <ListSwitch
                label={`Only in the brief: ${name}`}
                value={bot.briefOnly}
                disabled={update.isPending && update.variables?.id === id}
                onChange={(next) => setBriefOnly(bot, next)}
              />
            ) : null}
            {/* A saved brief keeps at least one bot; Delete removes the brief. */}
            {unsaved || sources.length > 1 ? (
              <Button
                label={`Remove ${name}`}
                variant="ghost"
                size="sm"
                iconOnly
                icon={<X size={16} color={colors.mutedForeground} />}
                onPress={() => onCommit({ ...draft, sources: sources.filter((s) => s !== id) }, "quick")}
              />
            ) : null}
          </View>
        }
      />
    );
  });
  if (watchBots.length) {
    rows.push(
      <ListRow
        key="add"
        title={sources.length ? "Add or remove bots" : "Add a bot"}
        tone="add"
        onPress={() => setPicking(true)}
      />,
    );
  } else if (sources.length === 0) {
    rows.push(<ListRow key="none" title="No bots to sum up yet" meta="Make a bot that watches something first" disabled />);
  }

  return (
    <>
      <View style={styles.section}>
        <GroupLabel aside={`${sources.length} of ${BOT_LIMITS.maxBriefSources}`}>Sums up</GroupLabel>
        <ListGroup>{rows}</ListGroup>
        <GroupHint>
          Each brief lists up to {BOT_LIMITS.briefItemsPerBot} new finds per bot, then “and N more”. Switch a bot to Only in the brief to hear
          about its finds here alone.
        </GroupHint>
      </View>

      <View style={styles.section}>
        <GroupLabel>Sends</GroupLabel>
        <ListGroup>
          <Select
            trigger="row"
            label="Daily at"
            value={time}
            options={times.map((t) => ({ value: t, label: t }))}
            onChange={(briefTime) => onCommit({ ...draft, briefTime }, "quick")}
          />
          <ListRow
            title="Write it with AI"
            trailing={
              <View style={styles.controls}>
                {!aiReady && !briefAi ? <Pill>Needs AI</Pill> : null}
                <ListSwitch
                  label="Write it with AI"
                  value={briefAi}
                  disabled={!aiReady && !briefAi}
                  onChange={(next) => onCommit({ ...draft, briefAi: next }, "quick")}
                />
              </View>
            }
          />
          {!aiReady && onSetUpAi ? (
            <ListRow
              title="Set up AI"
              meta="Add an AI provider so AI can write it"
              leading={<Sparkles size={18} color={colors.mutedForeground} />}
              onPress={onSetUpAi}
            />
          ) : null}
        </ListGroup>
        <GroupHint>One short AI call per brief; otherwise Timely lists the notes as they are.</GroupHint>
      </View>

      <AlertsGroup draft={draft} unsaved={unsaved} onCommit={onCommit} />

      {picking ? (
        <SourcesPage
          sources={sources}
          bots={watchBots}
          icons={icons}
          unsaved={unsaved}
          onClose={() => setPicking(false)}
          onSave={async (next) => {
            await onCommit({ ...draft, sources: next }, "page");
            setPicking(false);
          }}
        />
      ) : null}
    </>
  );
}

/** A brief's sends in the last week, from its recent alerts: the bot's week counts hold alerts only. */
function briefsThisWeek(detail: BotDetail, now: Date): number {
  const since = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return (detail.alerts ?? []).filter((a) => a.kind === "brief" && Date.parse(a.createdAt) >= since).length;
}

/**
 * The newest brief, where a watch bot shows its reading and latest alert:
 * the AI-written text when there is one, then one line per find (always
 * shown, since the AI text may leave some out), Useful / Not useful, and
 * this week's runs.
 */
export function LastBrief({ detail, now }: { detail: BotDetail; now: Date }) {
  const last = (detail.alerts ?? []).find((a) => a.kind === "brief");
  const lines = last?.lines ?? [];
  const written = last && last.aiState === "judged" ? last.body.trim() : "";
  const sent = briefsThisWeek(detail, now);
  return (
    <View style={styles.section}>
      <GroupLabel aside={last ? agoLabel(last.createdAt, now) : undefined}>Last brief</GroupLabel>
      <View style={styles.card}>
        {!last ? (
          <Text style={styles.meta}>
            No brief yet. The first one goes out at {detail.briefTime || DEFAULT_BRIEF_TIME}, once its bots find something.
          </Text>
        ) : (
          <>
            {written ? <Text style={styles.written}>{written}</Text> : null}
            {lines.length ? (
              <View>
                {lines.map((line, i) => (
                  <Text key={`${i}-${line}`} style={[styles.line, i > 0 && styles.lineDivider]}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : (
              <Text style={styles.meta}>{last.body || last.title}</Text>
            )}
            <AlertFeedback botId={detail.id} alert={last} />
          </>
        )}
        <View style={styles.week}>
          <View style={styles.weekRow}>
            <Text numberOfLines={2} style={[styles.meta, styles.weekMeta]}>
              {`${detail.week.checks} ${detail.week.checks === 1 ? "run" : "runs"} this week · ${sent} ${sent === 1 ? "brief" : "briefs"} sent`}
            </Text>
            <CheckStrip marks={detail.strip} count={STRIP_MARKS} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  section: { gap: 6 },
  controls: { flexDirection: "row", alignItems: "center", gap: 8 },
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 16, gap: 10, marginTop: 4 },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] },
  written: {
    borderRadius: 10,
    backgroundColor: colors.muted,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.foreground,
    fontSize: 13,
    lineHeight: 19,
  },
  line: { color: colors.foreground, fontSize: 14, lineHeight: 20, paddingVertical: 8, fontVariant: ["tabular-nums"] },
  lineDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  week: { marginTop: 2, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  weekRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  weekMeta: { flexShrink: 1, minWidth: 0 },
}));
