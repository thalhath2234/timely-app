import { useContext } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { isBotId, PRICE_BLOCK, priceHistory } from "@timely/contract/bots";
import AnimatedPressable from "../ui/AnimatedPressable";
import { PriceBody } from "../bots/PriceBody";
import { Link } from "../genui/kit";
import { ApiError } from "../../lib/api/client";
import { useBotQuery } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/** The block's words when there is no chart to draw. */
function Note({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.note}>
      <Text style={styles.noteTitle}>{title}</Text>
      {hint ? <Text style={styles.noteHint}>{hint}</Text> : null}
    </View>
  );
}

/*
 * A bot's price history in a live block (PriceHistory in genuiBoard.ts) drawn
 * natively: the twin of the web's report/priceHistoryBlock.tsx, laid out as
 * the bot sheet's price card. Read-only; it reads the bot by id only, so a
 * name or a reserved word is never fetched. The doc editor draws the same
 * block as HTML (editor/liveBlockHtml.ts).
 */
export function PriceHistoryBlock({ bot, watch }: { bot: string; watch?: string }) {
  const link = useContext(Link);
  const valid = isBotId(bot);
  const query = useBotQuery(valid ? bot : null, valid);
  if (!valid) return <Note title={PRICE_BLOCK.failed} />;
  if (query.error instanceof ApiError && query.error.status === 404) return <Note title={PRICE_BLOCK.deleted} hint={PRICE_BLOCK.deletedHint} />;
  if (!query.data) return query.isPending ? <View style={styles.loading} /> : <Note title={PRICE_BLOCK.failed} />;
  // GET /bots/:id falls back to a name match: another bot is not this block's.
  if (query.data.id !== bot) return <Note title={PRICE_BLOCK.failed} />;
  const model = priceHistory(query.data, watch);
  if (!model) return <Note title={PRICE_BLOCK.noPrice} />;
  const meta = [model.multiple ? model.label : "", model.paused ? "Paused" : ""].filter(Boolean).join(" · ");
  return (
    <View>
      <View style={styles.body}>
        {meta ? (
          <Text numberOfLines={1} style={styles.meta}>
            {meta}
          </Text>
        ) : null}
        <PriceBody model={model} />
      </View>
      {link ? (
        <View style={styles.foot}>
          <AnimatedPressable accessibilityRole="link" onPress={() => link(`timely://bot/${encodeURIComponent(bot)}`)} hitSlop={6} style={styles.open}>
            <Text style={styles.openText}>{PRICE_BLOCK.open}</Text>
            <ChevronRight size={14} color={colors.primary} />
          </AnimatedPressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 8 },
  meta: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  loading: { height: 150, margin: 14, borderRadius: 10, backgroundColor: colors.muted },
  note: { paddingHorizontal: 14, paddingVertical: 12, gap: 2 },
  noteTitle: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  noteHint: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  foot: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: 14, paddingVertical: 11 },
  open: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  openText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
}));
