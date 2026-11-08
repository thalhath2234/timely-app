import { Text, View } from "react-native";
import { formatMoney, signedPct, type PriceHistoryModel } from "@timely/contract/bots";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { PriceChart } from "./PriceChart";

/**
 * One price watch as drawn: the price now with the 30-day low at the right,
 * the line it watches with the change, then 30 days of closes. The bot
 * sheet's price card and a doc's price block share it.
 */
export function PriceBody({ model }: { model: PriceHistoryModel }) {
  const { currency } = model;
  return (
    <>
      <View style={styles.priceTop}>
        <Text numberOfLines={1} style={styles.price}>
          {model.value != null ? formatMoney(model.value, currency) : "—"}
        </Text>
        {model.low != null ? <Text style={styles.meta}>{`30-day low ${formatMoney(model.low, currency)}`}</Text> : null}
      </View>
      <Text style={[styles.meta, styles.priceLine]}>
        {model.value == null ? "Not read yet" : model.under ?? "Now"}
        {model.changePct != null ? (
          <>
            {" · "}
            <Text style={{ color: model.good ? colors.successText : colors.foreground }}>{signedPct(model.changePct)}</Text>
            {` since ${model.since}`}
          </>
        ) : null}
      </Text>
      <PriceChart points={model.points} threshold={model.threshold} currency={currency} />
    </>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] },
  priceTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  price: { flexShrink: 1, color: colors.foreground, fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  priceLine: { marginTop: -6, marginBottom: 4 },
}));
