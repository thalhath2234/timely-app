import { useState, type ReactNode } from "react";
import { Linking, Text, View } from "react-native";
import { Eye, KeyRound, Pencil, Play, RefreshCw, Wrench } from "lucide-react-native";
import {
  BOT_LIMITS,
  agoLabel,
  alertLink,
  captionLine,
  cardSub,
  cardValue,
  clockLabel,
  feedSources,
  fixButtons,
  fixCopy,
  footerRight,
  formatMoney,
  healthLine,
  isPriceReading,
  lineOf,
  miniValue,
  needsReason,
  primaryWatch,
  valueLine,
  watchCurrency,
  type AlertBrief,
  type BotNames,
  type BotView,
  type FixButton,
} from "@timely/contract/bots";
import AnimatedPressable from "../ui/AnimatedPressable";
import { Button } from "../ui/primitives";
import { ListRow } from "../settings/SettingsList";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { AlertFeedback } from "./AlertFeedback";
import { AlertAiLine } from "./AlertAiLine";
import { BotMark, type SiteIcons } from "./BotMark";
import { CheckStrip } from "./CheckStrip";
import { HealthLine } from "./HealthLine";
import { Pill } from "./Pill";
import { Sparkline } from "./Sparkline";
import { StrikeMeter } from "./StrikeMeter";
import { SuggestionButtons } from "./SuggestionCard";
import { withAlpha } from "./tone";
import type { BotActions } from "./useBotActions";

/** Marks in a card's row of checks: as many as fit beside a short value on a 360 px phone. */
const STRIP_MARKS = 22;

/** "+2.4% today" with the change tinted by its sign. */
function Delta({ text, style }: { text: string; style: object }) {
  const m = /^([+−]\d[\d.]*%)(.*)$/.exec(text);
  if (!m) return <Text numberOfLines={1} style={style}>{text}</Text>;
  return (
    <Text numberOfLines={1} style={style}>
      <Text style={{ color: m[1].startsWith("+") ? colors.successText : colors.destructive }}>{m[1]}</Text>
      {m[2]}
    </Text>
  );
}

/** The number on the right of a card's top row and the change under it ("₹27,499" / "₹2,499 above"). */
function topValue(bot: BotView, now: Date): { text: string; change: string | null } | null {
  const value = cardValue(bot);
  if (value.kind !== "number") return null;
  const w = primaryWatch(bot);
  if (w && isPriceReading(w)) {
    const mini = miniValue(bot, now);
    const day = w.kind === "price" && w.dayChangePct != null;
    const change = mini?.change ? (day ? `${mini.change} today` : mini.change) : null;
    return { text: value.text, change };
  }
  return { text: value.text, change: value.unit ?? null };
}

/** An alert as a headline and a line under it, as the web card words it. */
export function alertHeadline(alert: Pick<AlertBrief, "title" | "body">, botName: string): { title: string; meta: string } {
  const prefix = `${botName}: `;
  const what = alert.title.startsWith(prefix) ? alert.title.slice(prefix.length) : alert.title;
  const body = alert.body.replace(/ \(\+\d+ more\)$/, "");
  if (/^\d+ new items?$/.test(what) && body) return { title: body.replace(/ and \d+ more$/, ""), meta: what };
  return { title: what.charAt(0).toUpperCase() + what.slice(1), meta: body };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const unquote = (s: string) => s.replace(/^“|”$/g, "");

/** The two lines under a broken, stopped or key-less bot's name. */
function fixLines(bot: BotView, now: Date): { title: string; meta: string } {
  const reason = needsReason(bot, now);
  const copy = fixCopy(bot);
  if (reason === "stopped") {
    const since = captionLine(bot, now);
    const strikes = bot.strikes || BOT_LIMITS.maxStrikes;
    return { title: `Paused after ${strikes} strikes · ${lower(bot.health.line)}`, meta: since ? `${since}. ${copy.meta}` : copy.meta };
  }
  if (reason === "broken") {
    const value = cardValue(bot);
    const read = bot.lastOkAt
      ? `last good read ${agoLabel(bot.lastOkAt, now)}${value.kind === "text" && bot.lastCheckAt ? `: ${unquote(value.text)}` : ""}`
      : "no good read yet";
    const next = bot.nextCheckAt ? `next ${clockLabel(bot.nextCheckAt, now)}` : null;
    return { title: copy.title, meta: [`${bot.strikes} of ${BOT_LIMITS.maxStrikes} strikes`, read, next].filter(Boolean).join(" · ") };
  }
  return { title: copy.title, meta: copy.meta };
}

function fixIcon(button: FixButton, color: string) {
  switch (button.action) {
    case "check_now":
      return <RefreshCw size={16} color={color} />;
    case "resume":
    case "turn_on":
      return <Play size={16} color={color} />;
    case "add_key":
      return <KeyRound size={16} color={color} />;
    case "edit":
    case "edit_url":
      return <Pencil size={16} color={color} />;
  }
  return <Wrench size={16} color={color} />;
}

/** The top row: mark, name and sub line, and what sits on the right. */
function Top({ bot, icons, trailing }: { bot: BotView; icons: SiteIcons; trailing?: ReactNode }) {
  return (
    <View style={styles.top}>
      <BotMark watches={bot.watches} kind={bot.kind} icons={icons} />
      <View style={styles.topText}>
        <Text numberOfLines={2} style={styles.name}>
          {bot.name}
        </Text>
        <Text numberOfLines={1} style={styles.sub}>
          {cardSub(bot, { short: true })}
        </Text>
      </View>
      {trailing}
    </View>
  );
}

/**
 * The price line across the card, or the text value beside a row of checks.
 * A brief names the bots it sums up from `names`.
 */
function Middle({ bot, now, names }: { bot: BotView; now: Date; names?: BotNames }) {
  const [width, setWidth] = useState(0);
  const value = cardValue(bot);
  const w = primaryWatch(bot);
  const spark = w && isPriceReading(w) && (w.spark?.length ?? 0) >= 2 ? w.spark : null;
  if (w && spark) {
    const cur = watchCurrency(w);
    const closes = spark.map(([, v]) => v);
    return (
      <View style={styles.middle}>
        <View style={styles.sparkBox} onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))}>
          <Sparkline
            points={spark}
            threshold={lineOf(w)}
            width={width}
            summary={`Last 30 days: from ${formatMoney(closes[0], cur)} to ${formatMoney(closes[closes.length - 1], cur)}, low ${formatMoney(Math.min(...closes), cur)}`}
          />
        </View>
      </View>
    );
  }
  const caption = captionLine(bot, now, undefined, names);
  const under = caption ? null : w?.kind === "feed" ? feedSources(bot) : value.kind === "text" ? valueLine(bot) : null;
  const text = value.kind === "text" ? value.text : null;
  return (
    <View style={[styles.middle, styles.middleRow]}>
      <View style={styles.middleText}>
        {caption ? (
          <Text numberOfLines={1} style={styles.caption}>
            {caption}
          </Text>
        ) : null}
        {text ? (
          <Text numberOfLines={2} style={[styles.textValue, value.tone === "destructive" && { color: colors.destructive }]}>
            {text}
          </Text>
        ) : null}
        {under ? (
          <Text numberOfLines={1} style={styles.caption}>
            {under}
          </Text>
        ) : null}
      </View>
      <CheckStrip marks={bot.strip} count={STRIP_MARKS} />
    </View>
  );
}

function Footer({ bot, now, allPaused }: { bot: BotView; now: Date; allPaused?: boolean }) {
  const right = footerRight(bot, now, undefined, { allPaused });
  return (
    <View style={styles.footer}>
      <HealthLine bot={bot} now={now} allPaused={allPaused} />
      {right ? (
        <Text numberOfLines={1} style={styles.footerRight}>
          {right}
        </Text>
      ) : null}
    </View>
  );
}

/** What a "Needs you" card asks for, and its buttons. */
function Attention({ bot, now, actions, onOpen }: { bot: BotView; now: Date; actions: BotActions; onOpen?: () => void }) {
  const reason = needsReason(bot, now);
  const busy = actions.busy(bot);
  if (reason === "new_alert" && bot.latestAlert) {
    const alert = bot.latestAlert;
    const link = alertLink(bot, alert);
    const { title, meta } = alertHeadline(alert, bot.name);
    const ago = agoLabel(alert.createdAt, now);
    // A brief's body runs to several lines: its first one gets the clamp, and
    // the time a line of its own so the clamp never cuts it off.
    const brief = alert.kind === "brief";
    const line = brief ? (meta ?? "").split("\n")[0].trim() : [meta, ago].filter(Boolean).join(" · ");
    const box = (
      <>
        <Text numberOfLines={3} style={styles.alertTitle}>
          {title}
        </Text>
        {line ? (
          <Text numberOfLines={2} style={styles.meta}>
            {line}
          </Text>
        ) : null}
        {brief ? (
          <Text numberOfLines={1} style={styles.meta}>
            {ago}
          </Text>
        ) : null}
        <AlertAiLine alert={alert} variant="compact" />
      </>
    );
    return (
      <>
        {link ? (
          <AnimatedPressable
            accessibilityRole="link"
            accessibilityLabel={`${title}. ${link.label}`}
            onPress={() => void Linking.openURL(link.url)}
            style={styles.inner}
          >
            {box}
          </AnimatedPressable>
        ) : (
          <View style={styles.inner}>{box}</View>
        )}
        <View style={styles.buttons}>
          <View style={styles.grow}>
            <AlertFeedback botId={bot.id} alert={alert} />
          </View>
        </View>
      </>
    );
  }

  if (reason === "suggestion" && bot.suggestion) {
    const copy = fixCopy(bot);
    return (
      <>
        <View style={styles.copy}>
          <Text style={styles.copyTitle}>{copy.title}</Text>
          <Text style={styles.meta}>{copy.meta}</Text>
        </View>
        <SuggestionButtons bot={bot} actions={actions} style={styles.buttons} />
      </>
    );
  }

  if (reason === "waiting_ok") {
    const client = bot.originClient || "an outside app";
    return (
      <>
        <View style={styles.copy}>
          <Text style={styles.copyTitle}>{client.charAt(0).toUpperCase() + client.slice(1)} made this bot for you</Text>
          <Text style={styles.meta}>Bots made by outside apps start paused. Look it over, then turn it on.</Text>
        </View>
        <View style={styles.buttons}>
          <View style={styles.grow}>
            <Button
              label="Look it over"
              variant="outline"
              size="sm"
              stretch
              icon={<Eye size={16} color={colors.foreground} />}
              onPress={() => onOpen?.()}
            />
          </View>
          <View style={styles.grow}>
            <Button
              label="Turn on"
              size="sm"
              stretch
              loading={busy === "resume"}
              icon={<Play size={16} color={colors.primaryForeground} />}
              onPress={() => actions.act(bot, "turn_on")}
            />
          </View>
        </View>
      </>
    );
  }

  // broken, needs_key, stopped
  const { primary, secondary } = fixButtons(bot);
  const { title, meta } = fixLines(bot, now);
  const pending = (b: FixButton) =>
    (busy === "check_now" && b.action === "check_now") || (busy === "resume" && (b.action === "resume" || b.action === "turn_on"));
  return (
    <>
      <View style={styles.copy}>
        <Text style={[styles.copyTitle, { color: colors.destructive }]}>{title}</Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      <View style={styles.buttons}>
        {/* The fix stretches; the second button takes only its label's width. */}
        <View style={styles.grow}>
          <Button
            label={primary.label}
            size="sm"
            stretch
            loading={pending(primary)}
            icon={fixIcon(primary, colors.primaryForeground)}
            onPress={() => actions.act(bot, primary.action)}
          />
        </View>
        <Button
          label={secondary.label}
          variant="outline"
          size="sm"
          loading={pending(secondary)}
          icon={fixIcon(secondary, colors.foreground)}
          onPress={() => actions.act(bot, secondary.action)}
        />
      </View>
    </>
  );
}

/**
 * A bot on the phone board. `card` is a Watching card (value, price line or
 * row of checks, health); `attention` a "Needs you" card with a tinted edge,
 * what it needs and its buttons; `preview` a card that does nothing (a new
 * bot's "On your board"). `names` lets a brief name the bots it sums up;
 * `allPaused` (Pause all is on) shows on the footer.
 */
export function BotCard({
  bot,
  now,
  variant = "card",
  icons,
  names,
  allPaused,
  actions,
  onPress,
}: {
  bot: BotView;
  now: Date;
  variant?: "card" | "attention" | "preview";
  icons?: SiteIcons;
  names?: BotNames;
  allPaused?: boolean;
  actions: BotActions;
  onPress?: () => void;
}) {
  const reason = needsReason(bot, now);
  if (variant === "attention" && reason) {
    const warm = reason === "new_alert" || reason === "waiting_ok" || reason === "suggestion";
    const trailing =
      reason === "new_alert" ? (
        <Pill tone="primary">New alert</Pill>
      ) : reason === "waiting_ok" ? (
        <Pill tone="warning">Your OK</Pill>
      ) : reason === "suggestion" ? (
        <Pill tone="warning">Suggestion</Pill>
      ) : (
        <StrikeMeter strikes={bot.strikes} />
      );
    return (
      <View style={[styles.card, { borderColor: warm ? withAlpha(colors.warning, 0.45) : withAlpha(colors.destructive, 0.4) }]}>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={`${bot.name}, ${cardSub(bot)}`}
          accessibilityHint="Opens the bot"
          onPress={onPress}
          disabled={!onPress}
        >
          <Top bot={bot} icons={icons} trailing={trailing} />
        </AnimatedPressable>
        <Attention bot={bot} now={now} actions={actions} onOpen={onPress} />
      </View>
    );
  }

  const top = topValue(bot, now);
  const body = (
    <>
      <Top
        bot={bot}
        icons={icons}
        trailing={
          top ? (
            <View style={styles.value}>
              <Text numberOfLines={1} style={styles.valueText}>
                {top.text}
              </Text>
              {top.change ? <Delta text={top.change} style={styles.valueChange} /> : null}
            </View>
          ) : undefined
        }
      />
      <Middle bot={bot} now={now} names={names} />
      <Footer bot={bot} now={now} allPaused={allPaused} />
    </>
  );
  if (variant === "preview" || !onPress) return <View style={styles.card}>{body}</View>;
  const h = healthLine(bot, now);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={[bot.name, top?.text, top?.change, h.word].filter(Boolean).join(", ")}
      onPress={onPress}
      style={styles.card}
    >
      {body}
    </AnimatedPressable>
  );
}

/** A bot the person paused, as a grouped row: "Paused by you · Nov 2" and Resume. */
export function PausedRow({ bot, now, icons, actions, onPress }: { bot: BotView; now: Date; icons?: SiteIcons; actions: BotActions; onPress?: () => void }) {
  const h = healthLine(bot, now);
  return (
    <ListRow
      title={bot.name}
      meta={h.time ? `${h.word} · ${h.time}` : h.word}
      leading={<BotMark watches={bot.watches} kind={bot.kind} icons={icons} size={28} />}
      onPress={onPress}
      chevron={false}
      action={
        <Button
          label="Resume"
          variant="outline"
          size="sm"
          loading={actions.busy(bot) === "resume"}
          icon={<Play size={16} color={colors.foreground} />}
          onPress={() => actions.act(bot, "resume")}
        />
      }
    />
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" },
  top: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingTop: 14 },
  topText: { flex: 1, minWidth: 0 },
  name: { color: colors.foreground, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  sub: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  value: { alignItems: "flex-end", flexShrink: 0, maxWidth: "45%" },
  valueText: { color: colors.foreground, fontSize: 16, lineHeight: 20, fontWeight: "600", fontVariant: ["tabular-nums"] },
  valueChange: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] },
  middle: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
  sparkBox: { height: 34 },
  middleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  middleText: { flex: 1, minWidth: 0, gap: 2 },
  caption: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] },
  textValue: { color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "500" },
  footer: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerRight: { flexShrink: 0, maxWidth: "55%", color: colors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  inner: { marginTop: 12, marginHorizontal: 14, padding: 12, borderRadius: 12, backgroundColor: colors.muted, gap: 2 },
  alertTitle: { color: colors.foreground, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  copy: { paddingHorizontal: 14, paddingTop: 10, gap: 2 },
  copyTitle: { color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] },
  buttons: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  grow: { flex: 1, minWidth: 0 },
}));
