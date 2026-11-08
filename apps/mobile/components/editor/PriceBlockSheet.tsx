import { useMemo } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { cardValue, isPriceReading, PRICE_BLOCK, type BotView } from "@timely/contract/bots";
import BottomSheet from "../ui/BottomSheet";
import { ListGroup, ListRow } from "../settings/SettingsList";
import { BotMark, botSites } from "../bots/BotMark";
import { useBotIcons, useBotsQuery } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";

const LOADING_WIDTHS = ["55%", "40%", "62%"] as const;

/** A bot a price block can draw: one with a watch that reads a price. */
const watchesPrice = (bot: BotView) => bot.watches.some(isPriceReading);

/**
 * The "/" menu's "Bot price chart": the twin of the web's
 * editor/priceBlockPicker.tsx. The person's bots that watch a price, as
 * grouped rows (mark, name, the board card's value); picking one puts a live
 * block of its price history in the doc. No AI is needed.
 */
export default function PriceBlockSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (bot: BotView) => void }) {
  const router = useRouter();
  const query = useBotsQuery(open);
  const bots = useMemo(() => (query.data?.bots ?? []).filter(watchesPrice), [query.data]);
  const sites = useMemo(() => botSites(bots.flatMap((bot) => bot.watches)), [bots]);
  const icons = useBotIcons(sites).data;

  let body;
  if (query.isPending) {
    body = (
      <ListGroup>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.loadingRow} accessibilityLabel={i === 0 ? "Loading" : undefined}>
            <View style={styles.loadingMark} />
            <View style={[styles.loadingLine, { width: LOADING_WIDTHS[i] }]} />
          </View>
        ))}
      </ListGroup>
    );
  } else if (!query.data) {
    body = (
      <>
        <Text style={styles.lead}>Couldn’t load your bots.</Text>
        <ListGroup>
          <ListRow title="Try again" onPress={() => void query.refetch()} />
        </ListGroup>
      </>
    );
  } else if (!bots.length) {
    body = (
      <>
        <Text style={styles.lead}>{PRICE_BLOCK.pickEmpty}</Text>
        <ListGroup>
          <ListRow
            title="Open Bots"
            meta="Make a bot that watches a price, then add its chart here"
            onPress={() => {
              onClose();
              router.push("/(app)/(tabs)/bots" as Href);
            }}
          />
        </ListGroup>
      </>
    );
  } else {
    body = (
      <ListGroup>
        {bots.map((bot) => {
          const value = cardValue(bot);
          return (
            <ListRow
              key={bot.id}
              title={bot.name}
              meta={bot.status === "paused" ? "Paused" : undefined}
              leading={<BotMark watches={bot.watches} kind={bot.kind} icons={icons} size={28} />}
              trailing={
                <Text numberOfLines={1} style={[styles.value, value.tone === "destructive" && { color: colors.destructive }]}>
                  {value.text}
                </Text>
              }
              chevron={false}
              accessibilityLabel={`${bot.name}, ${value.text}`}
              onPress={() => onPick(bot)}
            />
          );
        })}
      </ListGroup>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={PRICE_BLOCK.pick} subtitle="Its price over 30 days, kept current as the bot checks.">
      {body}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  lead: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18, marginBottom: 8, marginHorizontal: 4 },
  value: { color: colors.mutedForeground, fontSize: 13, fontWeight: "500", maxWidth: 150, fontVariant: ["tabular-nums"] },
  loadingRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 },
  loadingMark: { width: 28, height: 28, borderRadius: 10, backgroundColor: colors.muted },
  loadingLine: { height: 12, borderRadius: 6, backgroundColor: colors.muted },
}));
