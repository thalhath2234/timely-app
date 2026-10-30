import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SkeletonRows } from "../../../components/ui/motionKit";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AlarmClock,
  BookOpen,
  CalendarCheck,
  FileText,
  CalendarClock,
  Check,
  ClipboardList,
  Clock3,
  Flame,
  Grid2x2,
  Goal,
  Hourglass,
  Inbox,
  LayoutGrid,
  ListChecks,
  NotebookPen,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Sheet as SheetIcon,
  Sparkles,
  Sun,
  Timer,
  Zap,
} from "lucide-react-native";
import {
  CARD_TEMPLATES,
  DASHBOARD_MAX_CARDS,
  cardTitle,
  catalogCards,
  computeCard,
  defaultDashboard,
  fitQuery,
  newCardId,
  type BuiltinCardType,
  type CardQuery,
  type CardRow,
  type DashboardCard,
} from "@timely/contract/dashboard";
import { describedCard, readBoardProgram } from "@timely/contract/genuiBoard";
import { dateInZone } from "@timely/contract/workStatus";
import Screen from "../../../components/ui/Screen";
import MobileHeader, { HeaderIconButton } from "../../../components/ui/MobileHeader";
import BottomSheet from "../../../components/ui/BottomSheet";
import ConfirmSheet from "../../../components/ui/ConfirmSheet";
import AnimatedPressable from "../../../components/ui/AnimatedPressable";
import EmptyState from "../../../components/ui/EmptyState";
import { SectionLabel } from "../../../components/ui/primitives";
import CustomCardView, { DISPLAY_ICON } from "../../../components/report/customCardView";
import CardEditor from "../../../components/report/CardEditor";
import FileCardView, { FILE_ICON, isFileQuery, useFileWatches } from "../../../components/report/fileCards";
import FileCardBuilder from "../../../components/report/fileCardBuilder";
import DescribedCardView from "../../../components/report/describedCard";
import DescribeCardSheet, { type DescribedDraft } from "../../../components/report/DescribeCardSheet";
import DashboardEditList, { type EditListScroll } from "../../../components/report/DashboardEditList";
import PomodoroCard from "../../../components/report/pomodoroCard";
import HighlightsCard from "../../../components/report/highlightsCard";
import { CountdownCard, DayProgressCard, MatrixCard, NotesCard, QuickCaptureCard, StreakCard, TodayCard } from "../../../components/report/builtinCards";
import {
  ClockCard,
  FocusTimeCard,
  GoalCard,
  HabitsCard,
  InboxZeroCard,
  JournalCard,
  NextUpCard,
  TopThreeCard,
  WeeklyReviewCard,
} from "../../../components/report/productivityCards";
import type { SettingsUpdate } from "../../../components/report/cardParts";
import { useDashboardData, useDashboardLayout, useNow } from "../../../lib/dashboard";
import { moveItem } from "../../../lib/dashboardReorder";
import { forgetPomodoro } from "../../../lib/pomodoroStore";
import { cancelPomodoroNotification } from "../../../lib/notifications";
import { useConfigQuery, useDecisionsStatusQuery, useInvalidateAll } from "../../../lib/hooks";
import { fileHref } from "../../../lib/fileRoutes";
import { eventHref } from "../../../lib/eventOccurrence";
import { showUndoToast, useToastStore } from "../../../lib/toast";
import type { CalendarItem } from "../../../lib/types";
import { colors, createThemedStyleSheet } from "../../../lib/theme";

const BUILTIN_ICON: Record<BuiltinCardType, typeof Timer> = {
  pomodoro: Timer,
  today: Sun,
  quickCapture: Zap,
  notes: NotebookPen,
  streak: Flame,
  dayProgress: Hourglass,
  matrix: Grid2x2,
  countdown: CalendarCheck,
  topThree: ListChecks,
  focusTime: Clock3,
  nextUp: CalendarClock,
  habits: Repeat,
  goal: Goal,
  weeklyReview: ClipboardList,
  inboxZero: Inbox,
  clock: AlarmClock,
  journal: BookOpen,
  highlights: Sparkles,
};

/** A card that is one figure: a number, a progress meter or a countdown. */
function isStatCard(card: DashboardCard) {
  if (card.type === "countdown") return true;
  if (card.type !== "custom" || !card.query) return false;
  if (card.query.sheet) return ["value", "counter", "progress"].includes(card.query.sheet.view);
  if (card.query.doc) return false;
  return card.query.display === "number" || card.query.display === "progress";
}

/** The saved order, with neighbouring stat cards paired into one row. */
function cardRows(cards: DashboardCard[]): DashboardCard[][] {
  const rows: DashboardCard[][] = [];
  for (const card of cards) {
    const last = rows[rows.length - 1];
    if (last && last.length === 1 && isStatCard(last[0]) && isStatCard(card)) last.push(card);
    else rows.push([card]);
  }
  return rows;
}

/** Stops what a card keeps running outside the screen: a pomodoro, or a timer's alert. */
function stopCard(card: DashboardCard) {
  if (card.type === "pomodoro") forgetPomodoro(card.id);
  if (card.type === "clock") void cancelPomodoroNotification(`clock-${card.id}`);
}

/** A card you made (from the workshop, a template, a sheet or a doc), whose setup can be changed. */
function isEditable(card: DashboardCard) {
  return card.type === "custom" && Boolean(card.query);
}

function cardIcon(card: DashboardCard) {
  if (card.type === "custom" && card.query?.described) return Sparkles;
  if (card.type === "custom" && card.query?.sheet) return FILE_ICON[card.query.sheet.view];
  if (card.type === "custom" && card.query?.doc) return FILE_ICON[card.query.doc.view];
  if (card.type === "custom") return DISPLAY_ICON[card.query?.display ?? "number"];
  return BUILTIN_ICON[card.type];
}

/**
 * The Dashboard on a phone: the same saved cards as web and desktop,
 * stacked in one column. Edit mode drags cards into a new order and removes
 * them. Cards built from a sheet or a doc can be made here too, and every card
 * you made can be changed (the edit button in edit mode, a long press on its
 * title, or `?edit=<card id>` from a home screen widget); sizes and building
 * cards from tasks or events stay on the bigger screens.
 */
export default function DashboardScreen() {
  const router = useRouter();
  const { layout, isLoading, isError, retry, update, updateCard } = useDashboardLayout();
  const cards = useMemo(() => layout?.cards ?? [], [layout]);
  const { data, today, failures, loading, eventsLoading, timeZone } = useDashboardData(cards);
  useFileWatches(cards);
  const [building, setBuilding] = useState<"sheets" | "docs" | null>(null);
  const config = useConfigQuery();
  const invalidateAll = useInvalidateAll();
  const now = useNow(30_000);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [describing, setDescribing] = useState(false);
  const smart = useDecisionsStatusQuery().data?.available === true;
  const [confirmReset, setConfirmReset] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const scrollerRef = useRef<ScrollView>(null);
  const frameRef = useRef<View>(null);
  const scrollState = useRef({ y: 0, contentH: 0 });
  const editScroll = useMemo<EditListScroll>(() => ({ ref: scrollerRef, frame: frameRef, state: scrollState }), []);
  const tasks = useMemo(() => data.tasks ?? [], [data.tasks]);
  const day = dateInZone(now, timeZone);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingCard = editingId ? cards.find((card) => card.id === editingId && isEditable(card)) : undefined;
  const editingKind = editingCard?.query && isFileQuery(editingCard.query) ? (editingCard.query.sheet ? "sheets" : "docs") : null;
  const editingDescribed = editingCard?.query?.described ? editingCard : undefined;
  const describeInitial = useMemo<DescribedDraft | undefined>(
    () =>
      editingDescribed?.query?.described
        ? { title: editingDescribed.title ?? "", prompt: editingDescribed.query.described.prompt, program: editingDescribed.query.described.program }
        : undefined,
    [editingDescribed],
  );

  // A widget's "Edit this card" opens the Dashboard on that card's setup.
  const params = useLocalSearchParams<{ edit?: string }>();
  useEffect(() => {
    if (!params.edit || !layout) return;
    if (layout.cards.some((card) => card.id === params.edit && isEditable(card))) setEditingId(params.edit);
    router.setParams({ edit: undefined });
  }, [layout, params.edit, router]);

  const saveEdit = (change: { title?: string; query: CardQuery }) => {
    if (editingId) updateCard(editingId, { title: change.title, query: change.query });
    setEditingId(null);
  };

  const openTask = useCallback((id: string) => router.push(`/(app)/tasks/${id}`), [router]);

  const openItem = useCallback(
    (item: CalendarItem) => {
      if (item.eventId) router.push(eventHref(item));
      else if (item.taskId) router.push(`/(app)/tasks/${item.taskId}`);
    },
    [router],
  );

  const openRow = useCallback(
    (row: CardRow) => {
      if (row.entity === "task") return router.push(`/(app)/tasks/${row.id}`);
      if (row.entity === "project") return router.push(`/(app)/projects/${row.id}`);
      if (row.entity === "doc" || row.entity === "sheet") return router.push(fileHref(row.id));
      const item = data.events?.find((entry) => entry.id === row.id);
      if (item) openItem(item);
    },
    [data.events, openItem, router],
  );

  // Links in a described card: screens by path, items as timely://kind/id.
  const openLink = useCallback(
    (href: string) => {
      const item = href.match(/^timely:\/\/(task|project|doc|sheet|event)\/([^/?#]+)/);
      if (item) return router.push(item[1] === "doc" || item[1] === "sheet" ? fileHref(item[2]) : `/(app)/${item[1]}s/${item[2]}`);
      if (href.startsWith("/")) router.push(`/(app)${href}`);
    },
    [router],
  );

  const addCard = (card: Omit<DashboardCard, "id">) => {
    if (cards.length >= DASHBOARD_MAX_CARDS) {
      useToastStore.getState().show(`A dashboard holds up to ${DASHBOARD_MAX_CARDS} cards`);
      return;
    }
    const id = newCardId();
    update((current) => ({ ...current, cards: [{ ...card, id }, ...current.cards] }));
    setAdding(false);
    setBuilding(null);
  };

  // A new card takes the size its program names; a changed one keeps its own unless the words resized it.
  const saveDescribed = (draft: DescribedDraft) => {
    const card = describedCard(editingDescribed?.id ?? "new", draft.prompt, draft.program, data);
    if (!card) return;
    if (editingDescribed) {
      const before = readBoardProgram(editingDescribed.query?.described?.program ?? "")?.size;
      const resized = !before || before.w !== card.w || before.h !== card.h;
      updateCard(editingDescribed.id, { title: draft.title || card.title, query: card.query, ...(resized ? { w: card.w, h: card.h } : {}) });
      setEditingId(null);
      return;
    }
    const { id: _id, ...fresh } = card;
    addCard({ ...fresh, title: draft.title || card.title });
    setDescribing(false);
  };

  const reorder = (from: number, to: number) =>
    update((current) => (from === to || !current.cards[from] ? current : { ...current, cards: moveItem(current.cards, from, to) }));

  const remove = (card: DashboardCard) => {
    const index = cards.findIndex((entry) => entry.id === card.id);
    update((current) => ({ ...current, cards: current.cards.filter((entry) => entry.id !== card.id) }));
    showUndoToast(`Removed ${cardTitle(card)}`, () =>
      update((current) => {
        if (current.cards.some((entry) => entry.id === card.id)) return current;
        const next = current.cards.slice();
        next.splice(Math.min(index, next.length), 0, card);
        return { ...current, cards: next };
      }),
    );
    // A removed pomodoro stops; undo brings the card back with a fresh timer.
    stopCard(card);
  };

  const renderBody = (card: DashboardCard) => {
    const settings = card.settings ?? {};
    const setSettings: SettingsUpdate = (next) =>
      updateCard(card.id, (current) => {
        const base = current.settings ?? {};
        return { ...current, settings: { ...base, ...(typeof next === "function" ? next(base) : next) } };
      });
    switch (card.type) {
      case "custom": {
        if (!card.query) return null;
        if (loading) return <SkeletonRows rows={3} height={28} bare />;
        if (isFileQuery(card.query)) return <FileCardView query={card.query} data={data} />;
        if (card.query.described)
          return <DescribedCardView program={card.query.described.program} data={data} timeZone={timeZone} now={now} onLink={openLink} />;
        return <CustomCardView query={card.query} result={computeCard(card.query, data, { now, timeZone })} onOpen={openRow} />;
      }
      case "pomodoro":
        return <PomodoroCard cardId={card.id} settings={settings} onSettings={setSettings} tasks={tasks} timeZone={timeZone} />;
      case "today":
        return (
          <TodayCard
            today={today.data}
            loading={today.isLoading}
            now={now}
            workingHours={config.data?.workingHours}
            onOpenTask={openTask}
            onOpenItem={openItem}
          />
        );
      case "quickCapture":
        return <QuickCaptureCard inboxCount={data.inbox?.length ?? 0} />;
      case "notes":
        return <NotesCard text={typeof settings.text === "string" ? settings.text : ""} onChange={(text) => setSettings({ text })} />;
      case "streak":
        return <StreakCard tasks={tasks} timeZone={timeZone} />;
      case "dayProgress":
        return <DayProgressCard now={now} workingHours={config.data?.workingHours} timeZone={timeZone} />;
      case "matrix":
        return (
          <MatrixCard tasks={tasks} timeZone={timeZone} urgentDays={typeof settings.urgentDays === "number" ? settings.urgentDays : 3} onOpenTask={openTask} />
        );
      case "highlights":
        return <HighlightsCard data={data} now={now} timeZone={timeZone} loading={loading} onOpenTask={openTask} />;
      case "countdown":
        return (
          <CountdownCard
            label={typeof settings.label === "string" ? settings.label : ""}
            date={typeof settings.date === "string" ? settings.date : ""}
            timeZone={timeZone}
            onChange={setSettings}
          />
        );
      case "topThree":
        return <TopThreeCard settings={settings} tasks={tasks} loading={loading} today={day} onSettings={setSettings} onOpenTask={openTask} />;
      case "focusTime":
        return <FocusTimeCard tasks={tasks} today={day} now={now} timeZone={timeZone} onOpenTask={openTask} />;
      case "nextUp":
        return (
          <NextUpCard
            events={data.events ?? []}
            loading={eventsLoading}
            now={now}
            today={day}
            workingHours={config.data?.workingHours}
            timeZone={timeZone}
            onOpenItem={openItem}
          />
        );
      case "habits":
        return <HabitsCard settings={settings} today={day} onSettings={setSettings} />;
      case "goal":
        return <GoalCard settings={settings} tasks={tasks} today={day} now={now} timeZone={timeZone} onSettings={setSettings} />;
      case "weeklyReview":
        return <WeeklyReviewCard settings={settings} tasks={tasks} today={day} timeZone={timeZone} onSettings={setSettings} onOpenTask={openTask} />;
      case "inboxZero":
        return <InboxZeroCard inbox={data.inbox ?? []} today={day} onOpenTask={openTask} />;
      case "clock":
        return <ClockCard cardId={card.id} title={cardTitle(card)} settings={settings} onSettings={setSettings} />;
      case "journal":
        return <JournalCard settings={settings} today={day} onSettings={setSettings} />;
    }
  };

  return (
    <Screen>
      <MobileHeader
        title="Dashboard"
        actions={
          <>
            {editing ? null : (
              <HeaderIconButton label="Add card" onPress={() => setAdding(true)}>
                <Plus size={20} color={colors.foreground} />
              </HeaderIconButton>
            )}
            <HeaderIconButton label={editing ? "Done editing" : "Edit dashboard"} active={editing} onPress={() => setEditing((value) => !value)}>
              {editing ? <Check size={20} color={colors.foreground} /> : <Pencil size={18} color={colors.foreground} />}
            </HeaderIconButton>
          </>
        }
      />
      <View ref={frameRef} collapsable={false} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollerRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          // Read by the edit list's drag, which scrolls this list near its edges. scrollEnabled is
          // not toggled while dragging (on web that resets the scroll to 0); the grip holds the touch.
          scrollEventThrottle={16}
          onScroll={(event) => {
            scrollState.current.y = event.nativeEvent.contentOffset.y;
          }}
          onContentSizeChange={(_width, height) => {
            scrollState.current.contentH = height;
          }}
          refreshControl={
            <RefreshControl
              enabled={!dragging}
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await Promise.all([invalidateAll(), retry()]).catch(() => undefined);
                setRefreshing(false);
              }}
            />
          }
        >
          {isError && !layout ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>Couldn't load your dashboard.</Text>
              <Text style={styles.link} onPress={() => void retry()}>
                Try again
              </Text>
            </View>
          ) : null}
          {failures.length > 0 ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>Couldn't load {failures.join(", ")}. Some cards may be empty.</Text>
            </View>
          ) : null}
          {isLoading && !layout ? <Text style={[styles.muted, { textAlign: "center", padding: 24 }]}>Loading your dashboard…</Text> : null}
          {layout && cards.length === 0 ? (
            <EmptyState
              icon={LayoutGrid}
              loop="cards"
              title="Your dashboard is empty"
              description="Add a productivity tool, a ready-made chart, or a card of your own from tasks, events, a sheet or a doc."
              action={
                <AnimatedPressable accessibilityRole="button" onPress={() => setAdding(true)} style={[styles.primary, { marginTop: 0 }]}>
                  <Plus size={16} color={colors.primaryForeground} />
                  <Text style={styles.primaryText}>Add card</Text>
                </AnimatedPressable>
              }
            />
          ) : null}

          {editing ? (
            <DashboardEditList
              cards={cards}
              iconFor={cardIcon}
              titleFor={cardTitle}
              scroll={editScroll}
              onReorder={reorder}
              onRemove={remove}
              canEdit={isEditable}
              onEdit={(card) => setEditingId(card.id)}
              onDragging={setDragging}
            />
          ) : (
            // Two stat cards share a row (the film's 2 x 2 grid); everything else is full width.
            cardRows(cards).map((row) => (
              <View key={row.map((card) => card.id).join("+")} style={row.length > 1 ? styles.cardRow : undefined}>
                {row.map((card) => {
                  const Icon = cardIcon(card);
                  return (
                    <View key={card.id} style={[styles.card, row.length > 1 && styles.halfCard]}>
                      {/* Holding the title of a card you made opens its setup. */}
                      <Pressable
                        accessible={false}
                        disabled={!isEditable(card)}
                        onLongPress={() => setEditingId(card.id)}
                        style={styles.cardHead}
                      >
                        {/* Half-width stat tiles drop the icon so the title has the room. */}
                        {row.length > 1 ? null : <Icon size={15} color={colors.mutedForeground} />}
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {cardTitle(card)}
                        </Text>
                      </Pressable>
                      {renderBody(card)}
                    </View>
                  );
                })}
              </View>
            ))
          )}

          {editing ? (
            <View style={{ gap: 10 }}>
              <Text style={[styles.muted, { textAlign: "center" }]}>Drag a card by its grip to move it. Change a card you made with its sliders button. Card sizes are on web and desktop.</Text>
              <AnimatedPressable accessibilityRole="button" onPress={() => setConfirmReset(true)} style={styles.secondary}>
                <RotateCcw size={15} color={colors.foreground} />
                <Text style={styles.secondaryText}>Reset to the default dashboard</Text>
              </AnimatedPressable>
            </View>
          ) : null}
        </ScrollView>
      </View>

      <BottomSheet open={adding} onClose={() => setAdding(false)} title="Add a card">
        <AnimatedPressable
          accessibilityRole="button"
          onPress={() => {
            setAdding(false);
            setDescribing(true);
          }}
          style={styles.option}
        >
          <Sparkles size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>Describe a card</Text>
            <Text style={styles.muted}>Say what it should show. The AI builds a live card from your tasks, events and files.</Text>
          </View>
        </AnimatedPressable>
        <SectionLabel>From your files</SectionLabel>
        {(
          [
            ["sheets", SheetIcon, "Card from a sheet", "Pick cells: a live value, chart, table, counter or quick add that saves into the sheet."],
            ["docs", FileText, "Card from a doc", "Pin a doc or one of its sections, or tick its checklist from here."],
          ] as const
        ).map(([kind, Icon, title, description]) => (
          <AnimatedPressable
            key={kind}
            accessibilityRole="button"
            onPress={() => {
              setAdding(false);
              setBuilding(kind);
            }}
            style={styles.option}
          >
            <Icon size={18} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>{title}</Text>
              <Text style={styles.muted}>{description}</Text>
            </View>
          </AnimatedPressable>
        ))}
        <SectionLabel>Productivity tools</SectionLabel>
        {catalogCards(smart).map((info) => {
          const Icon = BUILTIN_ICON[info.type];
          return (
            <AnimatedPressable
              key={info.type}
              accessibilityRole="button"
              onPress={() => addCard({ type: info.type, w: info.w, h: info.h, settings: info.settings ? { ...info.settings } : undefined })}
              style={styles.option}
            >
              <Icon size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>{info.title}</Text>
                <Text style={styles.muted}>{info.description}</Text>
              </View>
            </AnimatedPressable>
          );
        })}
        <SectionLabel>Ready-made charts</SectionLabel>
        {CARD_TEMPLATES.map((template) => {
          const Icon = DISPLAY_ICON[template.query.display];
          return (
            <AnimatedPressable
              key={template.id}
              accessibilityRole="button"
              onPress={() => addCard({ type: "custom", title: template.title, w: template.w, h: template.h, query: { ...template.query } })}
              style={styles.option}
            >
              <Icon size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>{template.title}</Text>
                <Text style={styles.muted}>{template.description}</Text>
              </View>
            </AnimatedPressable>
          );
        })}
        <Text style={[styles.muted, { marginTop: 12 }]}>Cards built by hand in the card workshop on web or desktop show up here too.</Text>
      </BottomSheet>

      <FileCardBuilder
        kind={building ?? editingKind}
        initial={!building && editingKind && editingCard?.query ? { id: editingCard.id, title: editingCard.title ?? "", query: fitQuery(editingCard.query) } : undefined}
        data={data}
        onClose={() => {
          setBuilding(null);
          setEditingId(null);
        }}
        onAdd={addCard}
        onSave={saveEdit}
      />
      <CardEditor card={!building && !editingKind && !editingDescribed && editingCard ? editingCard : null} onClose={() => setEditingId(null)} onSave={saveEdit} />
      <DescribeCardSheet
        open={describing || Boolean(!building && editingDescribed)}
        initial={describing ? undefined : describeInitial}
        onClose={() => {
          setDescribing(false);
          setEditingId(null);
        }}
        onSave={saveDescribed}
        onLink={openLink}
      />

      <ConfirmSheet
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset the dashboard?"
        message="Your cards are replaced with the default set, on every device. Notes and countdowns on removed cards are lost."
        confirmLabel="Reset"
        onConfirm={() => {
          for (const card of cards) stopCard(card);
          update(() => defaultDashboard());
          setConfirmReset(false);
          setEditing(false);
        }}
      />
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  list: { padding: 12, gap: 12, paddingBottom: 130 },
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14, gap: 12 },
  cardRow: { flexDirection: "row", gap: 12 },
  halfCard: { flex: 1, minWidth: 0, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  cardTitle: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: "600" },
  muted: { color: colors.mutedForeground, fontSize: 13 },
  banner: { borderRadius: 12, borderWidth: 1, borderColor: colors.destructive, padding: 12, gap: 4 },
  bannerText: { color: colors.foreground, fontSize: 13 },
  link: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  primary: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.primary },
  primaryText: { color: colors.primaryForeground, fontSize: 15, fontWeight: "600" },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  secondaryText: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  option: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10 },
  optionTitle: { color: colors.foreground, fontSize: 15, fontWeight: "600", marginBottom: 2 },
}));
