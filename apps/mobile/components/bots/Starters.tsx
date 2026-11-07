import { Text, View } from "react-native";
import { ChartCandlestick, Globe, MessageCircle, Rss, Sunrise, TrendingDown } from "lucide-react-native";
import type { Starter, StarterId } from "@timely/contract/bots";
import { Button } from "../ui/primitives";
import { ListGroup, ListRow } from "../settings/SettingsList";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { Pill } from "./Pill";

const STARTER_ICONS = {
  "trending-down": TrendingDown,
  globe: Globe,
  "chart-candlestick": ChartCandlestick,
  rss: Rss,
  sunrise: Sunrise,
};

/**
 * A starter: what it watches and when it tells you, as grouped rows, then
 * Use (the editor, filled in, no AI needed) and Describe in chat. A starter
 * that comes later is dimmed, tagged "Later", and cannot be used yet.
 */
export function StarterCard({
  starter,
  onUse,
  onChat,
}: {
  starter: Starter;
  onUse: (id: StarterId) => void;
  onChat: (text: string) => void;
}) {
  const Icon = STARTER_ICONS[starter.icon];
  const later = Boolean(starter.later);
  const chatText = starter.chatText;
  return (
    <View style={[styles.card, later && styles.later]}>
      <View style={styles.head}>
        <View style={styles.tile}>
          <Icon size={16} color={colors.foreground} />
        </View>
        <View style={styles.headText}>
          <Text numberOfLines={1} style={styles.name}>
            {starter.name}
          </Text>
          <Text numberOfLines={1} style={styles.sub}>
            {starter.sub}
          </Text>
        </View>
        {later ? <Pill>Later</Pill> : null}
      </View>
      <Text style={styles.quote}>“{starter.quote}”</Text>
      <ListGroup>
        {starter.rows.map(([label, value]) => (
          <ListRow
            key={label}
            title={label}
            accessibilityLabel={`${label}, ${value}`}
            trailing={
              <Text numberOfLines={2} style={styles.rowValue}>
                {value}
              </Text>
            }
          />
        ))}
      </ListGroup>
      {later ? (
        <View style={styles.footer}>
          <Text style={styles.footerNote}>Comes with Research bots</Text>
          <Button label="Use" variant="outline" size="sm" disabled onPress={() => undefined} />
        </View>
      ) : (
        <View style={styles.footer}>
          <View style={styles.grow}>
            <Button label="Use" variant="outline" size="sm" stretch onPress={() => onUse(starter.id)} />
          </View>
          {chatText ? (
            <View style={styles.grow}>
              <Button
                label="Describe in chat"
                variant="ghost"
                size="sm"
                stretch
                icon={<MessageCircle size={16} color={colors.mutedForeground} />}
                onPress={() => onChat(chatText)}
              />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14, gap: 12 },
  later: { opacity: 0.72 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  tile: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  headText: { flex: 1, minWidth: 0 },
  name: { color: colors.foreground, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  sub: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  quote: { color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "500" },
  // A starter's values run longer than a settings value, so they get more
  // room than ListRow's string trailing and may wrap.
  rowValue: { flexShrink: 1, maxWidth: "65%", color: colors.mutedForeground, fontSize: 13, fontWeight: "500", textAlign: "right" },
  footer: { flexDirection: "row", alignItems: "center", gap: 8 },
  footerNote: { flex: 1, color: colors.mutedForeground, fontSize: 12 },
  grow: { flex: 1, minWidth: 0 },
}));
