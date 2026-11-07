import { Text, View } from "react-native";
import { Image } from "expo-image";
import { Bot, ChartCandlestick, Globe, Rss, Tag } from "lucide-react-native";
import { hostOf, monogram, watchKindIcon, type WatchInput, type WatchView } from "@timely/contract/bots";
import { colors, createThemedStyleSheet } from "../../lib/theme";

/** Site logos by site, as data URIs; null when a site has none (`useBotIcons`). */
export type SiteIcons = Record<string, string | null> | undefined;

type MarkWatch = Pick<WatchView, "kind"> & Partial<Pick<WatchView, "site" | "url" | "read" | "symbol" | "source">>;

const KIND_ICONS = { tag: Tag, globe: Globe, rss: Rss, "chart-candlestick": ChartCandlestick };

/** The tile and logo sizes: 36 on a card, 28 in a row, 24 small. */
const SIZES = {
  24: { radius: 7, logo: 16 },
  28: { radius: 8, logo: 18 },
  36: { radius: 10, logo: 22 },
} as const;

/** The site of a page or feed watch; "" for a price. */
export function watchSite(w: MarkWatch | WatchInput): string {
  if (w.kind === "price") return "";
  return ("site" in w && w.site) || hostOf(w.url);
}

/** Every site a list of watches reads, sorted, for one logo request. */
export function botSites(watches: (MarkWatch | WatchInput)[]): string[] {
  return [...new Set(watches.map(watchSite).filter(Boolean))].sort();
}

function SiteLogo({ site, src, px, ring }: { site: string; src: string | null | undefined; px: number; ring?: boolean }) {
  if (src) {
    return (
      <Image
        source={{ uri: src }}
        accessible={false}
        contentFit="contain"
        transition={0}
        style={[{ width: px, height: px, borderRadius: 4 }, ring && styles.ring]}
      />
    );
  }
  return (
    <View style={[styles.letter, { width: px, height: px }, ring ? styles.ring : styles.letterEdge]}>
      <Text style={[styles.letterText, { fontSize: Math.round(px * 0.6) }]}>{(site.charAt(0) || "?").toUpperCase()}</Text>
    </View>
  );
}

/**
 * A bot's mark: its site's logo (or the site's first letter), two overlapped
 * logos when it reads two or more sites, or the symbol's letters for a price,
 * with the first watch's kind as a small corner badge. Same rules as the web.
 */
export function BotMark({
  watches,
  size = 36,
  icons,
  badge = size >= 28,
}: {
  watches: (MarkWatch | WatchInput)[];
  size?: 24 | 28 | 36;
  icons?: SiteIcons;
  badge?: boolean;
}) {
  const first = watches[0];
  const sites = botSites(watches);
  const { radius, logo } = SIZES[size];
  let inner;
  if (!first) {
    inner = <Bot size={Math.round(size / 2)} color={colors.mutedForeground} />;
  } else if (sites.length === 0) {
    const letters = monogram(first);
    const scale = letters.length >= 4 ? 0.28 : letters.length === 3 ? 0.32 : 0.42;
    inner = (
      <Text numberOfLines={1} style={[styles.symbol, { fontSize: Math.round(size * scale) }]}>
        {letters}
      </Text>
    );
  } else if (sites.length === 1) {
    inner = <SiteLogo site={sites[0]} src={icons?.[sites[0]]} px={logo} />;
  } else {
    const small = Math.round(logo * 0.78);
    inner = (
      <View style={{ width: small + 6, height: small + 4 }}>
        <View style={styles.pairFirst}>
          <SiteLogo site={sites[0]} src={icons?.[sites[0]]} px={small} />
        </View>
        <View style={styles.pairSecond}>
          <SiteLogo site={sites[1]} src={icons?.[sites[1]]} px={small} ring />
        </View>
      </View>
    );
  }
  const Kind = first ? KIND_ICONS[watchKindIcon(first)] : null;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { width: size, height: size, borderRadius: radius }]}
    >
      {inner}
      {badge && Kind ? (
        <View style={styles.badge}>
          <Kind size={10} color={colors.mutedForeground} />
        </View>
      ) : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  tile: { alignItems: "center", justifyContent: "center", backgroundColor: colors.muted },
  symbol: { color: colors.foreground, fontWeight: "600", letterSpacing: -0.3 },
  letter: { alignItems: "center", justifyContent: "center", borderRadius: 5, backgroundColor: colors.card },
  letterEdge: { borderWidth: 1, borderColor: colors.border },
  letterText: { color: colors.foreground, fontWeight: "600" },
  ring: { borderWidth: 1.5, borderColor: colors.muted },
  pairFirst: { position: "absolute", left: 0, top: 0 },
  pairSecond: { position: "absolute", right: 0, bottom: 0 },
  badge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
}));
