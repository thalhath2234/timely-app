import { useState } from "react";
import { Text, View } from "react-native";
import {
  clockLabel,
  formatMoney,
  type PreviewCandidate,
  type PreviewWatch,
} from "@timely/contract/bots";
import BottomSheet, { SheetOption } from "../ui/BottomSheet";
import { PrimaryButton } from "../ui/primitives";
import { GroupHint, GroupLabel } from "../settings/SettingsList";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { withAlpha } from "../bots/tone";

type Run = { kind: "plain" | "mark" | "struck"; text: string };

/** Code-point runs of an excerpt: the price it reads marked, struck prices struck. */
function excerptRuns(excerpt: NonNullable<PreviewWatch["excerpt"]>): Run[] {
  const chars = Array.from(excerpt.text);
  const kind = chars.map((): Run["kind"] => "plain");
  for (const [from, to] of excerpt.struck ?? [])
    for (let i = Math.max(0, from); i < Math.min(to, chars.length); i++)
      kind[i] = "struck";
  const [from, to] = excerpt.mark ?? [0, 0];
  for (let i = Math.max(0, from); i < Math.min(to, chars.length); i++)
    kind[i] = "mark";
  const runs: Run[] = [];
  chars.forEach((ch, i) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === kind[i]) last.text += ch;
    else runs.push({ kind: kind[i], text: ch });
  });
  return runs;
}

/**
 * What a watch read, in a mono box: the page excerpt with the price marked
 * and struck prices struck, the newest posts of a feed, or the part's text.
 */
export function Excerpt({ read }: { read: PreviewWatch }) {
  if (read.excerpt?.text)
    return (
      <Text style={styles.excerpt}>
        {excerptRuns(read.excerpt).map((run, i) => (
          <Text
            key={i}
            style={
              run.kind === "mark"
                ? styles.mark
                : run.kind === "struck"
                  ? styles.struckText
                  : undefined
            }
          >
            {run.text}
          </Text>
        ))}
      </Text>
    );
  if (read.items?.length)
    return (
      <View style={styles.box}>
        {read.items.slice(0, 5).map((item, i) => (
          <Text key={`${i}:${item.url}`} numberOfLines={1} style={styles.item}>
            {item.title || item.url}
          </Text>
        ))}
      </View>
    );
  if (read.text)
    return (
      <Text numberOfLines={5} style={styles.excerpt}>
        {read.text}
      </Text>
    );
  return null;
}

/** The candidate the bot reads now: the one at its value, else the first. */
function readingNow(watch: PreviewWatch): number {
  const at = (watch.candidates ?? []).findIndex(
    (c) => !c.struck && watch.value != null && c.amount === watch.value,
  );
  return at >= 0 ? at : 0;
}

function candidateDetail(candidate: PreviewCandidate, now: boolean) {
  if (candidate.struck) return "Struck-out price";
  if (now) return "What it reads now";
  if (candidate.from === "jsonld") return "The shop's own price data";
  if (candidate.from === "og" || candidate.from === "itemprop")
    return "The page's price tag";
  return "";
}

/**
 * "That's not it" on a proposed bot, as option 1 draws it: what it read,
 * the prices found on the page, and "Follow the <label>", which asks chat to
 * follow that price instead. "Something else…" starts a reply in words.
 */
export default function NotItSheet({
  open,
  onClose,
  botName,
  watch,
  onPick,
  onOther,
}: {
  open: boolean;
  onClose: () => void;
  botName: string;
  watch: PreviewWatch;
  onPick: (candidate: PreviewCandidate) => void;
  onOther: () => void;
}) {
  const candidates = watch.candidates ?? [];
  const now = readingNow(watch);
  const [picked, setPicked] = useState(now);
  const chosen = candidates[picked] ?? candidates[0];
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Which price should it follow?"
      subtitle={botName}
      footer={
        chosen ? (
          <PrimaryButton
            label={`Follow the ${chosen.label || "price"}`}
            onPress={() => {
              onClose();
              onPick(chosen);
            }}
          />
        ) : undefined
      }
    >
      <View style={styles.body}>
        <GroupLabel
          aside={watch.at ? clockLabel(watch.at, new Date()) : undefined}
        >
          What it read
        </GroupLabel>
        <Excerpt read={watch} />
        <GroupLabel aside={`${candidates.length} found`}>
          Prices on the page
        </GroupLabel>
        <View style={styles.options}>
          {candidates.map((candidate, i) => (
            <SheetOption
              key={`${i}:${candidate.selector}:${candidate.amount}`}
              selected={picked === i}
              onSelect={() => setPicked(i)}
              trailing={
                <Text
                  style={[styles.amount, candidate.struck && styles.struck]}
                >
                  {formatMoney(candidate.amount, candidate.currency)}
                </Text>
              }
            >
              <View style={{ gap: 2 }}>
                <Text numberOfLines={1} style={styles.label}>
                  {candidate.label || "Price"}
                </Text>
                {candidateDetail(candidate, i === now) ? (
                  <Text numberOfLines={1} style={styles.detail}>
                    {candidateDetail(candidate, i === now)}
                  </Text>
                ) : null}
              </View>
            </SheetOption>
          ))}
          <SheetOption
            onSelect={() => {
              onClose();
              onOther();
            }}
          >
            Something else…
          </SheetOption>
        </View>
        <GroupHint>
          None of these? Tell chat which number you mean and it reads the page
          again.
        </GroupHint>
      </View>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet(() => ({
  excerpt: {
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 21,
    color: colors.mutedForeground,
    backgroundColor: colors.muted,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    overflow: "hidden",
  },
  mark: {
    color: colors.foreground,
    backgroundColor: withAlpha(colors.warning, 0.28),
  },
  struckText: { textDecorationLine: "line-through" },
  box: {
    backgroundColor: colors.muted,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  item: { fontSize: 13, lineHeight: 18, color: colors.foreground },
  body: { gap: 8, paddingBottom: 8 },
  options: { gap: 2 },
  label: { fontSize: 15, fontWeight: "500", color: colors.foreground },
  detail: { fontSize: 13, color: colors.mutedForeground },
  amount: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  struck: {
    color: colors.mutedForeground,
    textDecorationLine: "line-through",
  },
}));
