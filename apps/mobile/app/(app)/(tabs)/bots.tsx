import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bot, MessageCircle, Plus } from "lucide-react-native";
import { boardOrder, boardSections, summaryLine, type StarterId } from "@timely/contract/bots";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import ListEnter from "../../../components/ui/ListEnter";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { SkeletonRows } from "../../../components/ui/motionKit";
import { FAB_GAP, FAB_SIZE, floatingTabBarInset, useFabScrollInset } from "../../../components/ui/FloatingTabBar";
import { ListGroup } from "../../../components/settings/SettingsList";
import { useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { BotCard, PausedRow } from "../../../components/bots/BotCard";
import { BotSheet } from "../../../components/bots/BotSheet";
import { botSites } from "../../../components/bots/BotMark";
import { BotsEmpty } from "../../../components/bots/BotsEmpty";
import { CountPill } from "../../../components/bots/Pill";
import { AGENT_SETTINGS_ROUTE, BOT_KEYS_ROUTE, useBotActions, useDescribeInChat } from "../../../components/bots/useBotActions";
import { contextChip } from "../../../lib/chat/context";
import { useNow } from "../../../lib/dashboard";
import { keys, useBotIcons, useBotsQuery } from "../../../lib/hooks";
import { needsNetworkCopy } from "../../../lib/queryCopy";
import { colors, createThemedStyleSheet, radius } from "../../../lib/theme";

/**
 * The Bots tab: Needs you (a new alert to rate, a bot to fix, a bot an
 * outside app made waiting for an OK), Watching and Paused, or the starters
 * before the first bot. A bot opens on `?bot=<id>` and New bot on
 * `?new=1&starter=<id>`, so a notification can open its bot.
 */
export default function BotsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bot?: string; new?: string; starter?: string; watch?: string }>();
  const insets = useSafeAreaInsets();
  const bottom = useFabScrollInset();
  const query = useBotsQuery();
  const queryClient = useQueryClient();
  // Only a pull shows the spinner: live updates and the idle poll refetch
  // the list too, and should change the cards without it.
  const [pulling, setPulling] = useState(false);
  const now = useNow(30_000);
  const describe = useDescribeInChat();
  useAssistantScreen([contextChip("bots", "Bots", "/bots")]);

  const openBot = useCallback(
    (id: string, watchId?: string) => router.setParams({ bot: id, new: undefined, starter: undefined, watch: watchId }),
    [router],
  );
  const openNew = useCallback(
    (starter?: StarterId) => router.setParams({ bot: undefined, new: "1", starter: starter ?? undefined }),
    [router],
  );
  const actions = useBotActions(openBot);
  const closeSheet = useCallback(
    () => router.setParams({ bot: undefined, new: undefined, starter: undefined, watch: undefined }),
    [router],
  );
  const addKey = useCallback(() => {
    closeSheet();
    router.push(BOT_KEYS_ROUTE as never);
  }, [closeSheet, router]);
  const setUpAi = useCallback(() => {
    closeSheet();
    router.push(AGENT_SETTINGS_ROUTE as never);
  }, [closeSheet, router]);

  const list = query.data;
  const sites = useMemo(() => botSites((list?.bots ?? []).flatMap((b) => b.watches)), [list]);
  const icons = useBotIcons(sites).data;
  const sections = useMemo(() => (list ? boardSections(list.bots, now) : null), [list, now]);
  const order = useMemo(() => (list ? boardOrder(list.bots, now) : []), [list, now]);
  const sheetMode = params.new === "1" ? "new" : params.bot ? "view" : null;
  const networkCopy = needsNetworkCopy(query);
  const empty = Boolean(list && list.bots.length === 0);

  const onRefresh = useCallback(async () => {
    setPulling(true);
    // The empty page also shows "Alerts for new bots", a query of its own.
    await Promise.all([
      query.refetch(),
      empty ? queryClient.invalidateQueries({ queryKey: keys.botDefaults }) : undefined,
    ]).catch(() => undefined);
    setPulling(false);
  }, [query, queryClient, empty]);

  let body;
  if (!list) {
    body =
      query.isPending && !networkCopy ? (
        <SkeletonRows rows={4} height={120} />
      ) : (
        <EmptyState icon={Bot} title="Couldn't load bots" description={networkCopy ?? "Pull down to try again."} />
      );
  } else if (list.bots.length === 0 || !sections) {
    body = <BotsEmpty onNew={() => openNew()} onStarter={openNew} onChat={describe} />;
  } else {
    let index = 0;
    body = (
      <>
        {sections.needs.length ? (
          <View style={styles.section}>
            <SectionLabel count={sections.needs.length} attn>
              Needs you
            </SectionLabel>
            {sections.needs.map((bot) => (
              <ListEnter key={bot.id} index={index++}>
                <BotCard bot={bot} now={now} variant="attention" icons={icons} actions={actions} onPress={() => openBot(bot.id)} />
              </ListEnter>
            ))}
          </View>
        ) : null}
        {sections.watching.length ? (
          <View style={styles.section}>
            <SectionLabel count={sections.watching.length}>Watching</SectionLabel>
            {sections.watching.map((bot) => (
              <ListEnter key={bot.id} index={index++}>
                <BotCard bot={bot} now={now} icons={icons} names={list.bots} actions={actions} onPress={() => openBot(bot.id)} />
              </ListEnter>
            ))}
          </View>
        ) : null}
        {sections.paused.length ? (
          <View style={styles.section}>
            <SectionLabel count={sections.paused.length}>Paused</SectionLabel>
            <ListEnter index={index++}>
              <ListGroup>
                {sections.paused.map((bot) => (
                  <PausedRow key={bot.id} bot={bot} now={now} icons={icons} actions={actions} onPress={() => openBot(bot.id)} />
                ))}
              </ListGroup>
            </ListEnter>
          </View>
        ) : null}
      </>
    );
  }

  return (
    <Screen>
      <MobileHeader
        title="Bots"
        subtitle={list && list.bots.length ? summaryLine(list, now, "phone") : undefined}
        actions={
          <HeaderIconButton label="Describe in chat" onPress={() => describe()}>
            <MessageCircle size={20} color={colors.foreground} />
          </HeaderIconButton>
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.body, { paddingBottom: bottom }]}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => void onRefresh()}
            tintColor={colors.primary}
          />
        }
      >
        {body}
      </ScrollView>
      {list ? (
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="New bot"
          onPress={() => openNew()}
          wrapStyle={[styles.fab, { bottom: floatingTabBarInset(insets.bottom) + FAB_GAP }]}
          style={styles.fabHit}
        >
          <Plus size={26} color={colors.primaryForeground} />
        </AnimatedPressable>
      ) : null}
      <BotSheet
        botId={params.bot}
        watchId={params.watch}
        mode={sheetMode}
        starter={params.starter}
        order={order}
        onSelect={openBot}
        onClose={closeSheet}
        onAddKey={addKey}
        onSetUpAi={setUpAi}
      />
    </Screen>
  );
}

/** A board section's heading with its count right beside it, as on desktop. */
function SectionLabel({ children, count, attn }: { children: string; count: number; attn?: boolean }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{children}</Text>
      <CountPill count={count} tone={attn ? "attn" : undefined} />
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, marginBottom: 2, marginHorizontal: 4 },
  label: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  body: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
  section: { gap: 8 },
  fab: {
    position: "absolute",
    right: 18,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: radius,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 10,
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  fabHit: { width: FAB_SIZE, height: FAB_SIZE, alignItems: "center", justifyContent: "center" },
}));
