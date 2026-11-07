import { useMemo } from "react";
import { Text, View } from "react-native";
import { ArrowUpRight } from "lucide-react-native";
import {
  agoLabel,
  answerMarkWatch,
  answerTone,
  answerWatchMeta,
  clockLabel,
  type BotAnswer,
  type HealthTone,
} from "@timely/contract/bots";
import { useBotIcons } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { BotMark, botSites } from "../bots/BotMark";
import { withAlpha } from "../bots/tone";
import { ListGroup, ListRow, ListSubLabel } from "../settings/SettingsList";
import { Button } from "../ui/primitives";

const dot = (tone: HealthTone) => {
  switch (tone) {
    case "ok":
      return colors.success;
    case "warn":
      return colors.warning;
    case "bad":
      return colors.destructive;
    case "primary":
      return colors.primary;
    default:
      return withAlpha(colors.mutedForeground, 0.6);
  }
};

/** How many findings an answer card lists. */
const FINDINGS = 3;

/**
 * A tagged bot's answer under the reply written from it: the bot, how fresh
 * its reading is, what each watch reads now, what it found this week, and
 * Open bot. It only shows; nothing on it changes the bot.
 */
export default function BotAnswerCard({
  answer,
  onOpen,
}: {
  answer: BotAnswer;
  /** Opens a link the way the thread does (`timely://bot/<id>`). */
  onOpen: (href: string) => void;
}) {
  const now = useMemo(() => new Date(), []);
  const marks = answer.watches.map(answerMarkWatch);
  const icons = useBotIcons(botSites(marks)).data;
  const tone = answerTone(answer);
  const findings = answer.findings.slice(0, FINDINGS);
  const alerts =
    answer.alertsToday > 0
      ? ` · ${answer.alertsToday} ${answer.alertsToday === 1 ? "alert" : "alerts"} today`
      : "";
  const next =
    answer.bot.status === "active" &&
    answer.nextCheckAt &&
    Date.parse(answer.nextCheckAt) > now.getTime()
      ? `Next check ${clockLabel(answer.nextCheckAt, now)}`
      : "";
  return (
    <View accessibilityLabel={`${answer.bot.name} answers`}>
      <ListGroup>
        <View style={styles.head}>
          <BotMark watches={marks} size={36} icons={icons} />
          <View style={styles.headText}>
            <Text numberOfLines={1} style={styles.name}>
              {answer.bot.name}
            </Text>
            <View style={styles.freshRow}>
              <View style={[styles.dot, { backgroundColor: dot(tone) }]} />
              <Text numberOfLines={2} style={styles.fresh}>
                {answer.freshLine}
                {alerts}
              </Text>
            </View>
          </View>
        </View>
        {tone === "bad" && answer.bot.health.line ? (
          <Text style={styles.broken}>{answer.bot.health.line}</Text>
        ) : null}
        {answer.watches.map((w, i) => (
          <ListRow
            key={w.id || i}
            title={w.title}
            meta={answerWatchMeta(w) || undefined}
            leading={
              answer.watches.length > 1 ? (
                <BotMark
                  watches={[marks[i]]}
                  size={28}
                  badge={false}
                  icons={icons}
                />
              ) : undefined
            }
            trailing={
              <Text numberOfLines={1} style={styles.value}>
                {w.summary || "Nothing read yet"}
              </Text>
            }
          />
        ))}
        {findings.length ? <ListSubLabel>Found this week</ListSubLabel> : null}
        {findings.map((f) => (
          <ListRow
            key={f.id}
            title={f.title}
            meta={f.why || undefined}
            trailing={agoLabel(f.createdAt, now)}
          />
        ))}
        <View style={styles.foot}>
          <Text numberOfLines={1} style={styles.next}>
            {next}
          </Text>
          <Button
            label="Open bot"
            variant="ghost"
            size="sm"
            icon={<ArrowUpRight size={16} color={colors.mutedForeground} />}
            accessibilityLabel={`Open ${answer.bot.name}`}
            onPress={() =>
              onOpen(`timely://bot/${encodeURIComponent(answer.bot.id)}`)
            }
          />
        </View>
      </ListGroup>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  freshRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  fresh: {
    flexShrink: 1,
    color: colors.mutedForeground,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  broken: {
    color: colors.destructive,
    fontSize: 13,
    fontWeight: "500",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  value: {
    maxWidth: 140,
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  foot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 4,
  },
  next: {
    flexShrink: 1,
    color: colors.mutedForeground,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
}));
