import { useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Text, useWindowDimensions, View } from "react-native";
import {
  AlarmClockOff,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock,
  Ellipsis,
  Eye,
  ExternalLink,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Sunrise,
  Trash2,
} from "lucide-react-native";
import {
  DEFAULT_BOT_SETTINGS,
  DEFAULT_BRIEF_TIME,
  agoLabel,
  alertMeta,
  briefClock,
  clockLabel,
  draftErrors,
  draftOf,
  emptyDraft,
  formatMoney,
  healthLine,
  isPriceReading,
  needsReason,
  originLine,
  priceHistory,
  runNowState,
  shortDate,
  snoozeLabel,
  starterById,
  starterDraft,
  toInput,
  toPatch,
  watchTitle,
  type BotDetail,
  type BotInput,
  type BotView,
  type HealthTone,
  type Rearm,
  type StarterId,
  type WatchView,
} from "@timely/contract/bots";
import AnimatedPressable from "../ui/AnimatedPressable";
import { PriceBody } from "./PriceBody";
import BottomSheet from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import SegmentedControl from "../ui/SegmentedControl";
import { SkeletonRows } from "../ui/motionKit";
import { Button, Field, PrimaryButton } from "../ui/primitives";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "../settings/SettingsList";
import {
  useBotDefaultsQuery,
  useBotIcons,
  useBotPreview,
  useBotQuery,
  useBotsQuery,
  useCreateBot,
  useDeleteBot,
  usePauseBot,
  useResumeBot,
  useRunBot,
  useSourceKeysQuery,
  useUpdateBot,
} from "../../lib/hooks";
import { ApiError } from "../../lib/api/client";
import { useNow } from "../../lib/dashboard";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { AlertAiLine } from "./AlertAiLine";
import { AlertFeedback } from "./AlertFeedback";
import { alertHeadline } from "./BotCard";
import { BotGroups, DeleteRow, LessonsGroup, useWatchViews, type Commit } from "./BotGroups";
import { BotMark, botSites } from "./BotMark";
import { BriefGroups, LastBrief } from "./BriefGroups";
import { CheckStrip } from "./CheckStrip";
import { HowItCameSheet } from "./HowItCameSheet";
import { SnoozeSheet } from "./SnoozeSheet";
import { SuggestionCard, suggests } from "./SuggestionCard";
import { withAlpha } from "./tone";
import { useBotActions } from "./useBotActions";
import { isStock } from "./watchDraft";
import { WorksWith, passInputs } from "./WorksWith";

const say = (message: string) => useToastStore.getState().show(message);

/** Marks in the sheet's row of checks, beside "28 checks this week · 0 alerts". */
const STRIP_MARKS = 16;

/** Whether a keyed price source has a saved key; unknown (still loading) counts as yes. */
function useHasKey() {
  const keys = useSourceKeysQuery().data;
  return (source: string) => !keys || keys.some((k) => k.source === source && k.keySet);
}

const isWebAddress = (url: string) => /^https?:\/\//i.test(url);

function toneColors(tone: HealthTone): { wash: string; ink: string } {
  switch (tone) {
    case "ok":
      return { wash: withAlpha(colors.success, 0.14), ink: colors.successText };
    case "warn":
      return { wash: withAlpha(colors.warning, 0.16), ink: colors.warningText };
    case "bad":
      return { wash: withAlpha(colors.destructive, 0.12), ink: colors.destructive };
    case "primary":
      return { wash: withAlpha(colors.primary, 0.14), ink: colors.primary };
    default:
      return { wash: colors.muted, ink: colors.mutedForeground };
  }
}

/** A small status chip under the description ("Working", "Checked 12 min ago"). */
function MetaChip({ children, tone }: { children: string; tone?: HealthTone }) {
  const c = tone ? toneColors(tone) : { wash: colors.muted, ink: colors.mutedForeground };
  return (
    <View style={[styles.chip, { backgroundColor: c.wash }]}>
      <Text numberOfLines={1} style={[styles.chipText, { color: c.ink }, tone && styles.chipStrong]}>
        {children}
      </Text>
    </View>
  );
}

/** A 36 px round header button, as Close is drawn. */
function HeaderButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <AnimatedPressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.headerButton} hitSlop={6}>
      {children}
    </AnimatedPressable>
  );
}

/** A picker over two or more watches of one kind, by symbol or site. */
function WatchPicker({ watches, value, onChange }: { watches: WatchView[]; value: string; onChange: (id: string) => void }) {
  if (watches.length < 2) return null;
  return (
    <View style={styles.picker}>
      <SegmentedControl
        size="sm"
        accessibilityLabel="Which watch"
        value={value}
        onChange={onChange}
        options={watches.map((w) => ({ value: w.id, label: w.kind === "price" ? w.symbol : w.site || watchTitle(w) }))}
      />
    </View>
  );
}

/** "28 checks this week · 0 alerts", the row of checks and its legend, closing a card. */
function WeekChecks({ detail }: { detail: BotDetail }) {
  return (
    <View style={styles.week}>
      <View style={styles.weekRow}>
        <Text numberOfLines={2} style={[styles.meta, styles.weekMeta]}>
          {`${detail.week.checks} ${detail.week.checks === 1 ? "check" : "checks"} this week · ${detail.week.alerts} ${detail.week.alerts === 1 ? "alert" : "alerts"}`}
        </Text>
        <CheckStrip marks={detail.strip} count={STRIP_MARKS} />
      </View>
      <CheckStrip marks="" legend />
    </View>
  );
}

/** The price card: now, the 30-day low, the line it watches, the chart and this week's checks. */
function PriceCard({ detail, watches }: { detail: BotDetail; watches: WatchView[] }) {
  const [picked, setPicked] = useState(watches[0].id);
  // PriceCard is drawn only for a bot with a price-reading watch.
  const model = priceHistory(detail, picked)!;
  return (
    <View style={styles.card}>
      <WatchPicker watches={watches} value={model.watchId} onChange={setPicked} />
      <PriceBody model={model} />
      <WeekChecks detail={detail} />
    </View>
  );
}

/** The latest reading of a page or feed: the part it reads, or the newest posts. */
function ReadingCard({ detail, watches, now }: { detail: BotDetail; watches: WatchView[]; now: Date }) {
  const [picked, setPicked] = useState(watches[0].id);
  const w = watches.find((x) => x.id === picked) ?? watches[0];
  const items = w.items ?? (w.latestItem ? [w.latestItem] : []);
  return (
    <View style={styles.card}>
      <WatchPicker watches={watches} value={w.id} onChange={setPicked} />
      <View style={styles.priceTop}>
        <Text style={styles.cardTitle}>Latest reading</Text>
        <Text style={styles.meta}>{w.lastReadingAt ? agoLabel(w.lastReadingAt, now) : "Not read yet"}</Text>
      </View>
      {w.kind === "feed" ? (
        items.length ? (
          <View style={styles.items}>
            {items.slice(0, 5).map((item, i) => (
              <AnimatedPressable
                key={`${item.url}-${i}`}
                accessibilityRole={isWebAddress(item.url) ? "link" : undefined}
                accessibilityLabel={item.title || "Untitled post"}
                disabled={!isWebAddress(item.url)}
                onPress={() => void Linking.openURL(item.url)}
                style={[styles.item, i > 0 && styles.itemDivider]}
              >
                <View style={styles.itemText}>
                  <Text numberOfLines={2} style={styles.itemTitle}>
                    {item.title || "Untitled post"}
                  </Text>
                  {item.publishedAt ? <Text style={styles.meta}>{shortDate(item.publishedAt)}</Text> : null}
                </View>
                {isWebAddress(item.url) ? <ExternalLink size={14} color={colors.mutedForeground} /> : null}
              </AnimatedPressable>
            ))}
          </View>
        ) : (
          <Text style={styles.meta}>No posts read yet.</Text>
        )
      ) : w.excerpt || w.summary ? (
        <>
          <Text style={styles.quote}>{w.excerpt || w.summary}</Text>
          <Text style={styles.meta}>{w.lastChangedAt ? `Last changed ${shortDate(w.lastChangedAt)}` : "No change seen yet"}</Text>
        </>
      ) : (
        <Text style={styles.meta}>Nothing read yet.</Text>
      )}
      <WeekChecks detail={detail} />
    </View>
  );
}

/** "Armed again Oct 30, back above ₹25,125. No alert for that." */
function rearmLine(rearm: Rearm, detail: BotDetail): string {
  const rule = detail.watches.find((w) => w.id === rearm.watchId)?.rules.find((r) => r.id === rearm.ruleId);
  const side = rule?.kind === "above" ? "below" : "above";
  return `Armed again ${shortDate(rearm.at)}, back ${side} ${formatMoney(rearm.value, rearm.currency)}. No alert for that.`;
}

/**
 * The newest alert with what the AI judge did ("Not checked by AI", held
 * back, also seen by), Useful / Not useful, a re-arm that came after it, and
 * "How this came to you".
 */
function LatestAlert({ detail }: { detail: BotDetail }) {
  const alert = (detail.alerts ?? []).find((a) => a.kind === "alert");
  const rearm = detail.rearms?.[0];
  const later = rearm && (!alert || Date.parse(rearm.at) > Date.parse(alert.createdAt)) ? rearm : null;
  const [how, setHow] = useState(false);
  // Held by the judge, or folded into another bot's alert on the same thing.
  const quiet = alert?.held === "judged" || alert?.held === "shared";
  return (
    <View style={styles.section}>
      <GroupLabel aside={`${detail.alertsMonth} in 30 days`}>Latest alert</GroupLabel>
      <View style={styles.card}>
        {alert ? (
          <>
            {alert.held === "judged" ? <Text style={styles.eyebrow}>Held back by AI</Text> : null}
            <View style={styles.alertHead}>
              <View style={[styles.alertDot, quiet && styles.alertDotQuiet]} />
              <Text style={[styles.alertTitle, quiet && styles.alertTitleQuiet]}>{alertHeadline(alert, detail.name).title}</Text>
            </View>
            <Text style={[styles.meta, styles.alertMeta]}>{alertMeta(alert)}</Text>
            <AlertAiLine alert={alert} variant="full" style={styles.alertAi} />
            <AlertFeedback botId={detail.id} alert={alert} />
          </>
        ) : (
          <Text style={styles.meta}>No alerts yet. A rule tells you once when it becomes true.</Text>
        )}
        {later ? <Text style={[styles.meta, styles.rearm]}>{rearmLine(later, detail)}</Text> : null}
      </View>
      {alert ? (
        <>
          <View style={styles.howRow}>
            <ListGroup>
              <ListRow title="How this came to you" onPress={() => setHow(true)} />
            </ListGroup>
          </View>
          <HowItCameSheet open={how} onClose={() => setHow(false)} bot={detail} alert={alert} links={detail.links} />
        </>
      ) : null}
    </View>
  );
}

/** A bot an outside app made: read it once, on request, before turning it on. */
function LookOver({ botId }: { botId: string }) {
  const [asked, setAsked] = useState(false);
  const preview = useBotPreview({ botId }, asked);
  const rows = preview.data?.watches ?? [];
  return (
    <View style={styles.section}>
      <GroupLabel aside="Read once, nothing saved">Right now it reads</GroupLabel>
      {!asked && !preview.data ? (
        <View style={[styles.card, styles.lookOver]}>
          <Text style={styles.meta}>Nothing has been read yet. Read its watches once to see what it would find before you turn it on.</Text>
          <Button label="Read it once now" variant="outline" size="sm" icon={<Eye size={16} color={colors.foreground} />} onPress={() => setAsked(true)} />
        </View>
      ) : preview.isLoading ? (
        <GroupHint>Reading it once…</GroupHint>
      ) : preview.error ? (
        <GroupHint>{preview.error.message}</GroupHint>
      ) : (
        <ListGroup>
          {rows.map((r) => (
            <ListRow
              key={r.index}
              title={r.site || r.summary || "Watch"}
              meta={(r.ok ? r.excerpt?.text || r.text : r.health?.line) || undefined}
              trailing={r.ok ? r.summary : "Can’t read"}
            />
          ))}
        </ListGroup>
      )}
    </View>
  );
}

/** One text field on its own page, kept with Save (the name, the description). */
function TextPage({
  open,
  title,
  initial,
  multiline,
  maxLength,
  hint,
  required,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  initial: string;
  multiline?: boolean;
  maxLength: number;
  hint?: string;
  required?: boolean;
  onSave: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const clean = multiline ? value.trim() : value.replace(/\s+/g, " ").trim();
  const save = async () => {
    setBusy(true);
    setRefused(null);
    try {
      await onSave(clean);
    } catch (error) {
      setRefused(error instanceof Error ? error.message : "That didn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      footer={<PrimaryButton label="Save" disabled={(required && !clean) || clean === initial.trim()} loading={busy} onPress={() => void save()} />}
    >
      <View style={styles.pageBody}>
        <Field
          label={title}
          value={value}
          onChangeText={(next) => {
            setValue(multiline ? next : next.replace(/[\r\n]+/g, " "));
            setRefused(null);
          }}
          multiline={multiline}
          autoGrow={multiline}
          autoCapitalize="sentences"
          maxLength={maxLength}
          autoFocus
          hint={hint}
        />
        {refused ? <Text style={styles.error}>{refused}</Text> : null}
      </View>
    </BottomSheet>
  );
}

type Page = null | "more" | "snooze" | "name" | "description" | "delete";

/** The open bot: its readings and alert first, then its settings as grouped rows. */
function ViewSheet({
  open,
  botId,
  watchId,
  order,
  onSelect,
  onClose,
  onClosed,
  onAddKey,
  onSetUpAi,
}: {
  open: boolean;
  botId: string | null;
  /** A watch to open on arrival (a fix such as "Pick the part again"). */
  watchId?: string;
  order: string[];
  onSelect: (id: string) => void;
  onClose: () => void;
  /** The sheet has slid away. */
  onClosed: () => void;
  onAddKey: () => void;
  onSetUpAi: () => void;
}) {
  const now = useNow(30_000);
  // Only an open sheet keeps its bot fresh; a closed one asks for nothing.
  const query = useBotQuery(botId, open);
  const board = useBotsQuery().data;
  const listed = board?.bots.find((b) => b.id === botId);
  const detail = query.data && query.data.id === botId ? query.data : undefined;
  const bot: BotView | undefined = detail ?? listed;
  const update = useUpdateBot();
  const pause = usePauseBot();
  const resume = useResumeBot();
  const run = useRunBot();
  const remove = useDeleteBot();
  const actions = useBotActions(onSelect);
  const hasKey = useHasKey();
  const views = useWatchViews(bot?.watches);
  const icons = useBotIcons(useMemo(() => botSites(bot?.watches ?? []), [bot?.watches])).data;
  const [page, setPage] = useState<Page>(null);
  const { width } = useWindowDimensions();
  // Switches show the new value at once, before the bot comes back.
  const [pending, setPending] = useState<Partial<BotInput>>({});
  const pendingSeq = useRef(0);
  const [shownId, setShownId] = useState(botId);
  if (botId !== shownId) {
    setShownId(botId);
    setPage(null);
    setPending({});
  }

  if (!bot) {
    // Only a 404 means the bot is gone; offline (paused) or a failed read is not that.
    const gone = query.error instanceof ApiError && query.error.status === 404;
    const failed = !gone && query.error && !query.isFetching ? query.error : null;
    return (
      <BottomSheet open={open} onClose={onClose} onClosed={onClosed} title="Bot">
        <View style={styles.pageBody}>
          {gone ? (
            <Text style={styles.meta}>This bot no longer exists.</Text>
          ) : failed ? (
            <>
              <Text style={styles.error}>{failed.message || "This bot could not be loaded."}</Text>
              <View style={styles.picker}>
                <Button label="Try again" variant="outline" size="sm" onPress={() => void query.refetch()} />
              </View>
            </>
          ) : (
            <SkeletonRows rows={4} height={80} />
          )}
        </View>
      </BottomSheet>
    );
  }

  // With the bot's page loaded the draft also holds its Pass to links, so an
  // edit compares them with the saved ones and never drops one.
  const links = detail?.links;
  const draft: BotInput = { ...draftOf(bot, links), ...pending };
  const brief = bot.kind === "brief";
  const commit: Commit = async (next, how) => {
    const patch = toPatch(bot, next, links);
    if (Object.keys(patch).length === 0) return;
    if (how === "page") {
      await update.mutateAsync({ id: bot.id, patch });
      return;
    }
    // Shown until the bot is read back; a later quick edit's pending value
    // is not wiped by an earlier one settling.
    const seq = ++pendingSeq.current;
    setPending((was) => ({ ...was, ...(patch as Partial<BotInput>) }));
    update.mutate(
      { id: bot.id, patch },
      {
        onError: (error) => say(error.message),
        onSettled: () => {
          if (pendingSeq.current === seq) setPending({});
        },
      },
    );
  };

  const reason = needsReason(bot, now);
  const allPaused = !!board?.summary.allPaused;
  const health = healthLine(bot, now, undefined, { allPaused });
  const origin = originLine(bot);
  const runNow = runNowState(bot, now);
  const index = order.indexOf(bot.id);
  const prev = index > 0 ? order[index - 1] : null;
  const next = index >= 0 && index < order.length - 1 ? order[index + 1] : null;
  const prices = bot.watches.filter((w) => isPriceReading(w));
  const readings = bot.watches.filter((w) => !isPriceReading(w));
  const snoozed = snoozeLabel(bot, now);
  // Three labelled buttons fit a 390 px phone with their icons; narrower, the words stay and the icons go.
  const roomy = width >= 380;
  const icon = (node: ReactNode) => (roomy ? node : undefined);

  const checkNow = () =>
    run.mutate(bot.id, {
      onSuccess: (result) => say(result.line),
      onError: (error) => say(error.message),
    });
  const act = (kind: "pause" | "resume" | "turn_on") =>
    (kind === "pause" ? pause : resume).mutate(bot.id, {
      onSuccess: () => say(kind === "pause" ? `${bot.name} is paused` : kind === "turn_on" ? `${bot.name} is on` : `${bot.name} is watching again`),
      onError: (error) => say(error.message),
    });

  const footer = (
    <View style={styles.footer}>
      {runNow.state !== "hidden" ? (
        <View style={styles.footWide}>
          <Button
            label={runNow.label}
            variant="outline"
            stretch
            dense
            icon={icon(runNow.state === "cooldown" ? <Clock size={16} color={colors.foreground} /> : <RefreshCw size={16} color={colors.foreground} />)}
            loading={runNow.state === "checking" || run.isPending}
            disabled={runNow.state === "cooldown"}
            accessibilityLabel={runNow.state === "cooldown" ? `${runNow.label}. ${runNow.hint}` : undefined}
            onPress={checkNow}
          />
        </View>
      ) : null}
      {bot.status === "active" || snoozed ? (
        <View style={styles.footCell}>
          <Button
            label={snoozed ? "Snoozed" : "Snooze"}
            variant="outline"
            stretch
            dense
            icon={icon(<AlarmClockOff size={16} color={colors.foreground} />)}
            onPress={() => setPage("snooze")}
          />
        </View>
      ) : null}
      <View style={styles.footCell}>
        {bot.status === "active" ? (
          <Button label="Pause" variant="outline" stretch dense icon={icon(<Pause size={16} color={colors.foreground} />)} loading={pause.isPending} onPress={() => act("pause")} />
        ) : reason === "waiting_ok" ? (
          <Button label="Turn on" stretch dense icon={icon(<Play size={16} color={colors.primaryForeground} />)} loading={resume.isPending} onPress={() => act("turn_on")} />
        ) : (
          <Button label="Resume" variant="outline" stretch dense icon={icon(<Play size={16} color={colors.foreground} />)} loading={resume.isPending} onPress={() => act("resume")} />
        )}
      </View>
    </View>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      onClosed={onClosed}
      leading={
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={`${bot.name}. Rename`}
          onPress={() => setPage("name")}
          style={styles.lead}
        >
          <BotMark watches={bot.watches} kind={bot.kind} size={28} icons={icons} />
          <Text numberOfLines={2} style={styles.name}>
            {bot.name}
          </Text>
        </AnimatedPressable>
      }
      action={
        <HeaderButton label="More" onPress={() => setPage("more")}>
          <Ellipsis size={18} color={colors.foreground} />
        </HeaderButton>
      }
      footer={footer}
    >
      <View style={styles.body}>
        <AnimatedPressable accessibilityRole="button" accessibilityLabel="Edit description" onPress={() => setPage("description")}>
          <Text style={bot.description ? styles.description : styles.descriptionEmpty}>{bot.description || "Add a description in your own words"}</Text>
        </AnimatedPressable>
        <View style={styles.chips}>
          <MetaChip tone={health.tone}>{health.time && health.time.startsWith("until ") ? `${health.word} ${health.time}` : health.word}</MetaChip>
          {bot.lastCheckAt ? <MetaChip>{`Checked ${agoLabel(bot.lastCheckAt, now)}`}</MetaChip> : null}
          {bot.status === "active" && bot.nextCheckAt && !allPaused ? (
            <MetaChip>{brief ? `Next brief ${briefClock(bot, bot.nextCheckAt, now)}` : `Next ${clockLabel(bot.nextCheckAt, now)}`}</MetaChip>
          ) : null}
          {origin ? <MetaChip>{origin}</MetaChip> : null}
        </View>

        {suggests(bot) ? <SuggestionCard bot={bot} actions={actions} /> : null}
        {reason === "waiting_ok" ? <LookOver botId={bot.id} /> : null}
        {!detail ? (
          <SkeletonRows rows={2} height={120} />
        ) : brief ? (
          <LastBrief detail={detail} now={now} />
        ) : (
          <>
            {prices.length ? <PriceCard key={`p-${bot.id}`} detail={detail} watches={prices} /> : null}
            {readings.length ? <ReadingCard key={`r-${bot.id}`} detail={detail} watches={readings} now={now} /> : null}
            <LatestAlert detail={detail} />
          </>
        )}

        {brief ? (
          <BriefGroups
            key={bot.id}
            draft={draft}
            bots={board?.bots ?? []}
            saved={bot.sources}
            summary={board?.summary}
            onCommit={commit}
            onSetUpAi={onSetUpAi}
          />
        ) : (
          <BotGroups
            key={bot.id}
            draft={draft}
            views={views}
            icons={icons}
            alertsToday={bot.alertsToday}
            hasKey={hasKey}
            onAddKey={onAddKey}
            onCommit={commit}
            openWatch={watchId}
            summary={board?.summary}
            aiChecksToday={bot.aiChecksToday}
            knowledgeView={bot.knowledge}
            onSetUpAi={onSetUpAi}
          />
        )}
        {detail && !brief ? (
          <WorksWith
            key={`w-${bot.id}`}
            botId={bot.id}
            passesTo={draft.passesTo ?? passInputs(bot.id, links)}
            links={links}
            bots={board?.bots ?? []}
            briefOnly={!!draft.briefOnly}
            onBriefOnly={(briefOnly) => void commit({ ...draft, briefOnly }, "quick")}
            onPasses={async (passesTo) => {
              await commit({ ...draft, passesTo }, "page");
            }}
            onOpenBot={onSelect}
          />
        ) : null}
        {detail ? <LessonsGroup bot={bot} botId={bot.id} lessons={detail.lessons ?? []} /> : null}
        <View style={styles.deleteRow}>
          <DeleteRow onPress={() => setPage("delete")} />
        </View>
      </View>

      <BottomSheet open={page === "more"} onClose={() => setPage(null)} title="More" subtitle={bot.name}>
        <View style={styles.pageBody}>
          <ListGroup>
            {runNow.state !== "hidden" ? (
              <ListRow
                title={runNow.label}
                meta={runNow.state === "cooldown" ? runNow.hint : undefined}
                leading={
                  runNow.state === "cooldown" ? <Clock size={18} color={colors.mutedForeground} /> : <RefreshCw size={18} color={colors.foreground} />
                }
                chevron={false}
                disabled={runNow.state !== "ready" || run.isPending}
                onPress={() => {
                  setPage(null);
                  checkNow();
                }}
              />
            ) : null}
            <ListRow
              title="Rename"
              leading={<Pencil size={18} color={colors.foreground} />}
              chevron={false}
              onPress={() => setPage("name")}
            />
            <ListRow
              title="Previous bot"
              leading={<ChevronUp size={18} color={colors.foreground} />}
              chevron={false}
              disabled={!prev}
              onPress={() => prev && onSelect(prev)}
            />
            <ListRow
              title="Next bot"
              leading={<ChevronDown size={18} color={colors.foreground} />}
              chevron={false}
              disabled={!next}
              onPress={() => next && onSelect(next)}
            />
          </ListGroup>
          <ListGroup>
            <ListRow
              title="Delete bot"
              tone="danger"
              leading={<Trash2 size={18} color={colors.destructive} />}
              onPress={() => setPage("delete")}
            />
          </ListGroup>
        </View>
      </BottomSheet>

      <SnoozeSheet bot={bot} open={page === "snooze"} onClose={() => setPage(null)} now={now} />

      {page === "name" ? (
        <TextPage
          open
          title="Name"
          initial={bot.name}
          maxLength={80}
          required
          onClose={() => setPage(null)}
          onSave={async (name) => {
            await commit({ ...draft, name }, "page");
            setPage(null);
          }}
        />
      ) : null}
      {page === "description" ? (
        <TextPage
          open
          title="Description"
          initial={bot.description}
          multiline
          maxLength={2000}
          hint="Your words. Edit them here; the bot keeps them with its rules."
          onClose={() => setPage(null)}
          onSave={async (description) => {
            await commit({ ...draft, description }, "page");
            setPage(null);
          }}
        />
      ) : null}

      <ConfirmSheet
        open={page === "delete"}
        onClose={() => setPage(null)}
        title={`Delete ${bot.name}?`}
        message="Its log, alerts and price history go too."
        confirmLabel="Delete"
        onConfirm={() =>
          remove.mutate(bot.id, {
            onSuccess: () => {
              say(`${bot.name} is deleted`);
              onClose();
            },
            onError: (error) => say(error.message),
          })
        }
      />
    </BottomSheet>
  );
}

/**
 * New bot: a blank editor or a starter's, the same groups as an open bot,
 * kept on the phone until Create bot. Closing a touched draft asks first.
 */
function NewSheet({
  open,
  starter,
  onCreated,
  onClose,
  onAddKey,
  onSetUpAi,
}: {
  open: boolean;
  starter?: StarterId | string | null;
  onCreated: (id: string) => void;
  onClose: () => void;
  onAddKey: () => void;
  onSetUpAi: () => void;
}) {
  const defaults = useBotDefaultsQuery();
  const board = useBotsQuery().data;
  const summary = board?.summary;
  const create = useCreateBot();
  const hasKey = useHasKey();
  const settings = defaults.data ?? DEFAULT_BOT_SETTINGS;
  const from = starterById(starter);
  const [draft, setDraft] = useState<BotInput>(() => emptyDraft());
  const [touched, setTouched] = useState(false);
  // Leaving a touched draft asks first: by closing it, or for the Finnhub key or an AI provider in Settings.
  const [leaving, setLeaving] = useState<"close" | "key" | "ai" | null>(null);
  // Fill the draft when the sheet opens, and again when the person's alert
  // defaults arrive, unless it has been touched by then.
  const seed = open ? `${from?.id ?? "blank"}|${defaults.data ? "saved" : "default"}` : null;
  const [seeded, setSeeded] = useState<string | null>(null);
  if (seed !== seeded && (seed === null || !touched)) {
    setSeeded(seed);
    if (seed !== null) setDraft((from && starterDraft(from, settings)) || emptyDraft(settings));
  }
  const icons = useBotIcons(useMemo(() => botSites(draft.watches), [draft.watches])).data;
  const problems = draftErrors(draft, hasKey);
  const brief = draft.kind === "brief";
  const firstBrief = draft.briefTime || DEFAULT_BRIEF_TIME;
  const needsKey = draft.watches.some((w) => w.kind === "price" && isStock(w.source)) && !hasKey("finnhub");

  const change = (next: BotInput) => {
    setDraft(next);
    setTouched(true);
    create.reset();
  };
  const close = () => (touched ? setLeaving("close") : onClose());
  const addKey = () => (touched ? setLeaving("key") : onAddKey());
  const setUpAi = () => (touched ? setLeaving("ai") : onSetUpAi());
  const submit = () =>
    create.mutate(toInput(draft), {
      onSuccess: (view) => {
        say(
          view.kind === "brief"
            ? `${view.name} is set up. Its first brief goes out at ${view.briefTime || DEFAULT_BRIEF_TIME}.`
            : `${view.name} is set up. Its first check runs now.`,
        );
        setTouched(false);
        onCreated(view.id);
      },
    });

  const line = create.error
    ? create.error.message
    : touched && problems.length
      ? problems[0]
      : brief
        ? `Sends its first brief at ${firstBrief}.`
        : "Lands in Watching once its first check works.";
  return (
    <BottomSheet
      open={open}
      onClose={close}
      onClosed={() => {
        setTouched(false);
        setLeaving(null);
        create.reset();
      }}
      leading={
        <View style={styles.lead}>
          <View style={styles.newTile}>
            {brief ? <Sunrise size={16} color={colors.mutedForeground} /> : <Bot size={16} color={colors.mutedForeground} />}
          </View>
          <Text numberOfLines={1} style={styles.name}>
            New bot
          </Text>
        </View>
      }
      footer={
        <View style={styles.newFooter}>
          <Text numberOfLines={2} style={create.error ? styles.error : styles.meta}>
            {line}
          </Text>
          <PrimaryButton label="Create bot" disabled={problems.length > 0} loading={create.isPending} onPress={submit} />
        </View>
      }
    >
      <View style={styles.body}>
        <View>
          <Field
            bare
            large
            value={draft.name}
            onChangeText={(name) => change({ ...draft, name: name.replace(/[\r\n]+/g, " ") })}
            placeholder="Name your bot"
            autoCapitalize="sentences"
            accessibilityLabel="Bot name"
            maxLength={80}
          />
          <Field
            bare
            multiline
            autoGrow
            value={draft.description}
            onChangeText={(description) => change({ ...draft, description })}
            placeholder="What should it keep an eye on, in your own words?"
            autoCapitalize="sentences"
            accessibilityLabel="Description"
            maxLength={2000}
          />
          <Text style={styles.meta}>Optional. Your words are kept with the bot so you remember why you made it.</Text>
        </View>
        {needsKey ? (
          <Text style={styles.meta}>
            Stock prices need your free Finnhub key.{" "}
            <Text accessibilityRole="link" style={styles.link} onPress={addKey}>
              Add a free Finnhub key
            </Text>
          </Text>
        ) : null}
        {brief ? (
          <BriefGroups
            key={seeded ?? "closed"}
            draft={draft}
            bots={board?.bots ?? []}
            summary={summary}
            unsaved
            onCommit={(next) => change(next)}
            onSetUpAi={setUpAi}
          />
        ) : (
          <BotGroups
            key={seeded ?? "closed"}
            draft={draft}
            icons={icons}
            hasKey={hasKey}
            onAddKey={addKey}
            onCommit={(next) => change(next)}
            unsaved
            summary={summary}
            onSetUpAi={setUpAi}
          />
        )}
      </View>
      <ConfirmSheet
        open={leaving !== null}
        onClose={() => setLeaving(null)}
        title="Discard this new bot?"
        message="What you set up here is not kept."
        confirmLabel="Discard"
        onConfirm={() => {
          setTouched(false);
          if (leaving === "key") onAddKey();
          else if (leaving === "ai") onSetUpAi();
          else onClose();
        }}
      />
    </BottomSheet>
  );
}

/**
 * The bot sheet on the Bots tab, opened from `?bot=<id>` (an open bot) or
 * `?new=1&starter=<id>` (New bot). An open bot shows its price or latest
 * reading, its latest alert and its settings as grouped rows; each row opens
 * a page with Save, and Check now, Snooze and Pause sit in the footer.
 */
export function BotSheet({
  botId,
  watchId,
  mode,
  starter,
  order,
  onSelect,
  onClose,
  onAddKey,
  onSetUpAi,
}: {
  botId?: string | null;
  /** A watch of the bot to open on arrival. */
  watchId?: string;
  mode: "view" | "new" | null;
  starter?: StarterId | string | null;
  /** The board's order, for Previous and Next. */
  order: string[];
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Opens the Finnhub key row in Settings › Agent. */
  onAddKey: () => void;
  /** Opens Settings › Agent to add an AI provider. */
  onSetUpAi: () => void;
}) {
  // While the sheet slides away the bot stays drawn, so it never empties first.
  const [lastId, setLastId] = useState(botId ?? null);
  if (botId && botId !== lastId) setLastId(botId);
  return (
    <>
      <ViewSheet
        open={mode === "view" && !!botId}
        botId={botId ?? lastId}
        watchId={watchId}
        order={order}
        onSelect={onSelect}
        onClose={onClose}
        onClosed={() => setLastId(null)}
        onAddKey={onAddKey}
        onSetUpAi={onSetUpAi}
      />
      <NewSheet open={mode === "new"} starter={starter} onCreated={onSelect} onClose={onClose} onAddKey={onAddKey} onSetUpAi={onSetUpAi} />
    </>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { gap: 10, paddingTop: 2, paddingBottom: 8 },
  pageBody: { gap: 12, paddingTop: 4 },
  section: { gap: 6 },
  lead: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  name: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 17, lineHeight: 22, fontWeight: "600" },
  newTile: { width: 28, height: 28, borderRadius: 10, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  headerButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  description: { color: colors.foreground, fontSize: 15, lineHeight: 21 },
  descriptionEmpty: { color: colors.mutedForeground, fontSize: 15, lineHeight: 21 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { height: 22, borderRadius: 999, paddingHorizontal: 8, justifyContent: "center", maxWidth: "100%" },
  chipText: { fontSize: 12, fontWeight: "500", fontVariant: ["tabular-nums"] },
  chipStrong: { fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] },
  error: { color: colors.destructive, fontSize: 12, lineHeight: 17 },
  link: { color: colors.primary, fontWeight: "600" },
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 16, gap: 8, marginTop: 4 },
  picker: { alignItems: "flex-start" },
  priceTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  cardTitle: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  quote: {
    borderRadius: 10,
    backgroundColor: colors.muted,
    paddingHorizontal: 12,
    paddingVertical: 10,
    // Words read off a page are prose: the body font, not code.
    color: colors.foreground,
    fontSize: 13,
    lineHeight: 19,
  },
  items: { gap: 0 },
  item: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  itemDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  itemText: { flex: 1, minWidth: 0, gap: 2 },
  itemTitle: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
  week: { gap: 10, marginTop: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  // One row, the strip right-aligned, as the mock draws it.
  weekRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  weekMeta: { flexShrink: 1, minWidth: 0 },
  alertHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  alertDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  alertTitle: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  alertDotQuiet: { backgroundColor: withAlpha(colors.mutedForeground, 0.6) },
  alertTitleQuiet: { color: colors.mutedForeground },
  alertMeta: { paddingLeft: 14, marginTop: -6, marginBottom: 4 },
  alertAi: { paddingLeft: 14, marginTop: -4, marginBottom: 4 },
  eyebrow: { paddingLeft: 14, color: colors.mutedForeground, fontSize: 11, fontWeight: "500", letterSpacing: 0.88, textTransform: "uppercase" },
  howRow: { marginTop: 4 },
  rearm: { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  lookOver: { borderColor: withAlpha(colors.warning, 0.45), alignItems: "flex-start" },
  deleteRow: { marginTop: 8 },
  footer: { flexDirection: "row", gap: 8 },
  footWide: { flexGrow: 1.5, flexShrink: 1, flexBasis: "auto", minWidth: 0 },
  footCell: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0 },
  newFooter: { gap: 8 },
}));
