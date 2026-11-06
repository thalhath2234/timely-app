import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { LayoutDashboard } from "lucide-react-native";
import { liveBlockCards, readBoardProgram } from "@timely/contract/genuiBoard";
import { useDashboardData, useNow } from "../../lib/dashboard";
import { hrefFor } from "../../lib/searchRoutes";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import DescribedCardView from "./describedCard";

/*
 * A live block outside the doc editor: the Describe sheet's preview and docs
 * drawn natively (version previews, RichDoc). The frame matches the editor's
 * own (editorHtml.ts .live-*): the block's name, the Live mark, then its rows
 * edge to edge.
 */

export function LiveBlockFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.block} accessibilityLabel={`Live block: ${title}`}>
      <View style={styles.head}>
        <LayoutDashboard size={16} color={colors.mutedForeground} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.mark}>
          <View style={styles.dot} />
          <Text style={styles.markText}>Live</Text>
        </View>
      </View>
      {/* DescribedCardView bleeds past a board card's padding; the block has none. */}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

/** A doc's live block drawn from the app's data, read-only. */
export default function LiveBlockCard({ program }: { program: string }) {
  const router = useRouter();
  const cards = useMemo(() => liveBlockCards([program]), [program]);
  const { data, timeZone, loading } = useDashboardData(cards);
  const now = useNow(60_000);
  const title = useMemo(() => readBoardProgram(program)?.title || "Live block", [program]);
  const open = (href: string) => {
    const item = /^timely:\/\/(task|project|doc|sheet|event)\/([^/?#]+)/.exec(href);
    if (item) router.push(hrefFor(item[1] as "task", decodeURIComponent(item[2])));
    else if (href.startsWith("/")) router.push(`/(app)${href}` as never);
  };
  return (
    <LiveBlockFrame title={title}>
      {loading ? (
        <Text style={styles.loading}>Loading…</Text>
      ) : (
        <DescribedCardView program={program} data={data} timeZone={timeZone} now={now} onLink={open} />
      )}
    </LiveBlockFrame>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  block: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { flexShrink: 1, color: colors.foreground, fontSize: 14, fontWeight: "600" },
  mark: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  markText: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  body: { paddingHorizontal: 14, paddingBottom: 14 },
  loading: { color: colors.mutedForeground, fontSize: 14, paddingVertical: 12 },
}));
