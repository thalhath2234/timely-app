import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ACTIVITY, type LearningEvent } from "@timely/contract/agentLearning";
import Screen from "../../../../components/ui/Screen";
import MobileHeader from "../../../../components/ui/MobileHeader";
import BottomSheet from "../../../../components/ui/BottomSheet";
import { Button, PrimaryButton } from "../../../../components/ui/primitives";
import { GroupHint, ListGroup, ListRow } from "../../../../components/settings/SettingsList";
import { Block, DiffBlock, TextBlock } from "../../../../components/settings/LearnedParts";
import { useLearningFeedQuery, useUndoLearning } from "../../../../lib/hooks";
import { useLearningWatch } from "../../../../lib/chat/useLearningWatch";
import { activityRow, canUndo } from "../../../../lib/chat/learning";
import { isOffline } from "../../../../lib/networkState";
import { createThemedStyleSheet } from "../../../../lib/theme";

/** Activity: everything Timely learned, newest first, each with what changed and Undo. */
export default function LearnedActivity() {
  const insets = useSafeAreaInsets();
  const { event: openId } = useLocalSearchParams<{ event?: string }>();
  const feed = useLearningFeedQuery();
  useLearningWatch();
  const events = useMemo(() => feed.data?.pages.flat() ?? [], [feed.data]);
  const [shownId, setShownId] = useState<string | null>(null);
  // View on a chat's chip opens its change here, once.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !openId || !events.some((ev) => ev.id === openId)) return;
    opened.current = true;
    setShownId(openId);
  }, [openId, events]);
  const shown = events.find((ev) => ev.id === shownId) ?? null;

  return (
    <Screen>
      <MobileHeader title={ACTIVITY} back large={false} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom, gap: 6 }}
      >
        {feed.isLoading ? <Text style={styles.meta}>Loading…</Text> : null}
        {feed.error ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.error}>{feed.error.message || "Could not load the activity."}</Text>
            <PrimaryButton label="Try again" onPress={() => void feed.refetch()} />
          </View>
        ) : null}
        {feed.data && events.length === 0 ? (
          <GroupHint>Nothing yet. What Timely learns from your chats shows up here, with Undo.</GroupHint>
        ) : null}
        {events.length ? (
          <ListGroup testID="learned-feed">
            {events.map((ev) => {
              const row = activityRow(ev);
              return <ListRow key={ev.id} testID={`learned-event-${ev.id}`} title={row.title} meta={row.meta} onPress={() => setShownId(ev.id)} />;
            })}
            {feed.hasNextPage ? (
              <ListRow
                title={feed.isFetchingNextPage ? "Loading…" : "Show older"}
                tone="add"
                disabled={feed.isFetchingNextPage}
                onPress={() => void feed.fetchNextPage()}
              />
            ) : null}
          </ListGroup>
        ) : null}
      </ScrollView>
      <EventSheet event={shown} onClose={() => setShownId(null)} />
    </Screen>
  );
}

/** One change: its summary, before and after, and Undo while it is in effect. */
function EventSheet({ event: open, onClose }: { event: LearningEvent | null; onClose: () => void }) {
  const undo = useUndoLearning();
  // The last change shown stays drawn while the sheet slides away.
  const last = useRef(open);
  if (open) last.current = open;
  const event = open ?? last.current;
  const row = event ? activityRow(event) : null;
  const undoable = !!event && canUndo(event);
  const memory = event ? event.kind !== "skill" : false;
  return (
    <BottomSheet
      open={!!open}
      onClose={onClose}
      title={row?.title}
      subtitle={row?.meta}
      footer={
        undoable ? (
          <Button
            testID="learned-event-undo"
            label="Undo"
            variant="outline"
            stretch
            loading={undo.isPending}
            disabled={isOffline()}
            onPress={() => event && undo.mutate([event.id], { onSuccess: onClose })}
          />
        ) : undefined
      }
    >
      {event ? (
        <View style={{ gap: 12 }} testID="learned-event-sheet">
          {event.summary ? <Text style={styles.text}>{event.summary}</Text> : null}
          {event.before ? (
            <Block label="Before">{memory ? <TextBlock text={event.before} /> : <DiffBlock text={event.before} />}</Block>
          ) : null}
          {event.after ? (
            <Block label={event.before ? "After" : "Added"}>
              {memory ? <TextBlock text={event.after} /> : <DiffBlock text={event.after} />}
            </Block>
          ) : null}
          {memory && undoable ? <GroupHint>{"Changes to what Timely remembers apply from your next chat."}</GroupHint> : null}
          {undo.error && undo.variables?.[0] === event.id ? <Text style={styles.error}>{undo.error.message || "Could not undo."}</Text> : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  meta: { color: colors.mutedForeground, fontSize: 13 },
  text: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
  error: { color: colors.destructive, fontSize: 12, marginHorizontal: 4 },
}));
