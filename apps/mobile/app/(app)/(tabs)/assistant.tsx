import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bot, MessageCircle, Plus, Search, X } from "lucide-react-native";
import { AGENT_STARTERS, type BotView } from "@timely/contract/bots";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import EmptyState from "../../../components/ui/EmptyState";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import { SkeletonRows } from "../../../components/ui/motionKit";
import { Button, Field } from "../../../components/ui/primitives";
import { FAB_GAP, FAB_SIZE, floatingTabBarInset, useFabScrollInset } from "../../../components/ui/FloatingTabBar";
import { ListGroup, SwitchRow } from "../../../components/settings/SettingsList";
import { useAssistant, useAssistantScreen } from "../../../components/chat/AssistantProvider";
import { AssistantInbox } from "../../../components/assistant/AssistantInbox";
import { BotThread } from "../../../components/assistant/BotThread";
import { ConvertCard } from "../../../components/assistant/ConvertCard";
import { NewBotSheet } from "../../../components/assistant/NewBotSheet";
import { filterInbox } from "../../../components/assistant/inbox";
import { useInbox } from "../../../components/assistant/useAssistantData";
import { AgentBotPage } from "../../../components/bots/AgentBotPage";
import { BotSheet } from "../../../components/bots/BotSheet";
import { nextToConvert, starterRequest } from "../../../components/bots/agentBot";
import { AGENT_SETTINGS_ROUTE, BOT_KEYS_ROUTE } from "../../../components/bots/useBotActions";
import { contextChip } from "../../../lib/chat/context";
import { useNow } from "../../../lib/dashboard";
import { useBotsQuery, useSetAllPaused } from "../../../lib/hooks";
import { needsNetworkCopy } from "../../../lib/queryCopy";
import { colors, createThemedStyleSheet, radius } from "../../../lib/theme";

type Params = { chat?: string; bot?: string; thread?: string; new?: string; starter?: string; ask?: string; watch?: string };

/**
 * The Assistant tab: chats and Bots in one inbox (Needs you first, then
 * everything else, newest first). A chat opens in the assistant; a Bot opens
 * its page, and its thread by `thread=1`. It also receives the old routes:
 * `?chat=<id>`, `?bot=<id>`, `?bot=<id>&thread=1`, `?new=1&starter=<id>` and
 * `?ask=1` (a fresh chat, from the Ask shortcut and widgets).
 */
export default function AssistantTab() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const assistant = useAssistant();
  const insets = useSafeAreaInsets();
  const bottom = useFabScrollInset();
  const nowDate = useNow(30_000);
  const now = nowDate.getTime();
  const { inbox, bots, loading, error, refetch } = useInbox(nowDate);
  const setAllPaused = useSetAllPaused();
  const board = useBotsQuery();
  const [pulling, setPulling] = useState(false);
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState(false);
  // The thread of a Bot that is not created yet: a draft that was left open, or a fresh one.
  const [fresh, setFresh] = useState<{ id: string | null; first?: string } | null>(null);
  const [offered, setOffered] = useState<Set<string>>(new Set());
  useAssistantScreen([contextChip("bots", "Assistant", "/assistant")]);

  const clear = useCallback(
    () => router.setParams({ chat: undefined, bot: undefined, thread: undefined, new: undefined, starter: undefined, ask: undefined, watch: undefined }),
    [router],
  );

  // A chat link opens the chat; the Ask shortcut opens a fresh one. Then the link is spent.
  useEffect(() => {
    if (!assistant.hydrated) return;
    if (params.chat) {
      assistant.open(params.chat);
      router.setParams({ chat: undefined });
    } else if (params.ask) {
      assistant.open();
      router.setParams({ ask: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.chat, params.ask, assistant.hydrated]);

  // ?new=1 opens the new-Bot flow; a Starter in the link goes straight to its thread.
  useEffect(() => {
    if (params.new !== "1") return;
    const starter = AGENT_STARTERS.find((s) => s.key === params.starter);
    router.setParams({ new: undefined, starter: undefined });
    if (starter) setFresh({ id: null, first: starterRequest(starter) });
    else setPicking(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.new, params.starter]);

  const openBot = useCallback((id: string) => router.setParams({ bot: id, thread: undefined, watch: undefined }), [router]);
  const openThread = useCallback((id: string) => router.setParams({ bot: id, thread: "1" }), [router]);
  const filtered = useMemo(() => filterInbox(inbox, search), [inbox, search]);
  const rowCount = inbox.needs.length + inbox.recent.length;
  const networkCopy = needsNetworkCopy(board);
  const agentBots = (bots ?? []) as (BotView & { engine?: string })[];
  const target = agentBots.find((b) => b.id === params.bot);
  const convert = nextToConvert(agentBots, offered);

  const onRefresh = useCallback(async () => {
    setPulling(true);
    await refetch().catch(() => undefined);
    setPulling(false);
  }, [refetch]);

  const empty = !loading && rowCount === 0 && !error;
  const needs = inbox.needs.length;
  const botCount = bots?.length ?? 0;
  const allPaused = !!board.data?.summary.allPaused;

  return (
    <Screen>
      <MobileHeader
        title="Assistant"
        subtitle={allPaused ? "All Bots are paused" : needs ? `${needs} ${needs === 1 ? "needs" : "need"} you` : botCount ? `${botCount} ${botCount === 1 ? "Bot" : "Bots"} on watch` : undefined}
        actions={
          <HeaderIconButton label="New chat" onPress={() => assistant.open()}>
            <MessageCircle size={20} color={colors.foreground} />
          </HeaderIconButton>
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.body, { paddingBottom: bottom }]}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onRefresh()} tintColor={colors.primary} />}
      >
        {rowCount > 6 ? (
          <View style={styles.search}>
            <Search size={16} color={colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Field bare placeholder="Search chats and Bots" value={search} onChangeText={setSearch} accessibilityLabel="Search chats and Bots" />
            </View>
            {search ? (
              <AnimatedPressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch("")}>
                <X size={16} color={colors.mutedForeground} />
              </AnimatedPressable>
            ) : null}
          </View>
        ) : null}
        {convert ? <ConvertCard key={convert.id} bot={convert} onDismiss={() => setOffered((now) => new Set(now).add(convert.id))} /> : null}
        {loading ? <SkeletonRows rows={4} height={64} /> : null}
        {error && !bots && !loading ? (
          <EmptyState icon={Bot} title="Couldn't load the Assistant" description={networkCopy ?? "Pull down to try again."} />
        ) : null}
        {empty ? (
          <EmptyState
            icon={MessageCircle}
            title="Nothing here yet"
            description="Ask Timely something, or set up a Bot to watch for you."
            action={<Button label="New Bot" icon={<Bot size={16} color={colors.primaryForeground} />} onPress={() => setPicking(true)} />}
          />
        ) : null}
        <AssistantInbox
          inbox={filtered}
          now={now}
          onOpenChat={(id) => assistant.open(id)}
          onOpenBot={openBot}
          onOpenDraft={(id) => setFresh({ id })}
        />
        {botCount > 0 && !search ? (
          <ListGroup>
            <SwitchRow
              title="Pause all Bots"
              meta="Nothing is checked or sent while it is on."
              value={allPaused}
              onChange={(paused) => setAllPaused.mutate(paused)}
            />
          </ListGroup>
        ) : null}
      </ScrollView>
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel="New Bot"
        onPress={() => setPicking(true)}
        wrapStyle={[styles.fab, { bottom: floatingTabBarInset(insets.bottom) + FAB_GAP }]}
        style={styles.fabHit}
      >
        <Plus size={26} color={colors.primaryForeground} />
      </AnimatedPressable>

      <NewBotSheet
        open={picking}
        onClose={() => setPicking(false)}
        onStart={(first) => {
          setPicking(false);
          setFresh({ id: null, first });
        }}
      />
      {fresh ? (
        <BotThread
          key={fresh.id ?? fresh.first ?? "new"}
          id={fresh.id}
          firstMessage={fresh.first}
          onClose={() => setFresh(null)}
          onCreated={(botId) => {
            setFresh(null);
            openBot(botId);
          }}
        />
      ) : null}
      {params.bot && params.thread ? (
        <BotThread
          key={`thread-${params.bot}`}
          id={params.bot}
          title={target?.name}
          onClose={clear}
          onCreated={openBot}
          onEdit={() => router.setParams({ thread: undefined })}
        />
      ) : null}
      {params.bot && !params.thread && target ? (
        target.engine === "agent" ? (
          <AgentBotPage key={target.id} botId={target.id} onClose={clear} onTalk={() => openThread(target.id)} />
        ) : (
          <BotSheet
            botId={params.bot}
            watchId={params.watch}
            mode="view"
            order={(bots ?? []).map((b) => b.id)}
            onSelect={openBot}
            onClose={clear}
            onAddKey={() => {
              clear();
              router.push(BOT_KEYS_ROUTE as never);
            }}
            onSetUpAi={() => {
              clear();
              router.push(AGENT_SETTINGS_ROUTE as never);
            }}
          />
        )
      ) : null}
    </Screen>
  );
}

const styles = createThemedStyleSheet(() => ({
  body: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
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
