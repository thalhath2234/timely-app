import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cardLine, WAITING_FOR_YOU } from "@timely/contract/agentLearning";
import Screen from "../../../../components/ui/Screen";
import MobileHeader from "../../../../components/ui/MobileHeader";
import BottomSheet from "../../../../components/ui/BottomSheet";
import { Button, PrimaryButton } from "../../../../components/ui/primitives";
import { GroupHint, ListGroup, ListRow } from "../../../../components/settings/SettingsList";
import { Block, DiffBlock, Tile } from "../../../../components/settings/LearnedParts";
import { useDecidePendingLearning, usePendingLearningQuery, useStagedLearningQuery } from "../../../../lib/hooks";
import { useLearningWatch } from "../../../../lib/chat/useLearningWatch";
import { pendingMeta, pendingWhy, stagedAsPending } from "../../../../lib/chat/learning";
import type { PendingView } from "../../../../lib/api/learning";
import { isOffline } from "../../../../lib/networkState";
import { createThemedStyleSheet } from "../../../../lib/theme";

/**
 * Waiting for you: changes the agent staged instead of making (Q-3.1: the
 * chat read something from outside Timely, or a bot wrote it), listed from
 * Timely's own staged events as on the web. Each opens with its diff (the
 * worker's, read when a change opens), Keep and Discard; a change the worker
 * no longer has says so and can still be discarded.
 */
export default function Waiting() {
  const insets = useSafeAreaInsets();
  const { pending: openId } = useLocalSearchParams<{ pending?: string }>();
  const pending = useStagedLearningQuery();
  const [shownId, setShownId] = useState<string | null>(null);
  const diffs = usePendingLearningQuery(!!shownId || !!openId);
  useLearningWatch();
  const items = (pending.data ?? []).map((ev) => stagedAsPending(ev, diffs.data));
  // View diff on a chat's card opens its change here, once.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !openId || !items.some((item) => item.pending_id === openId)) return;
    opened.current = true;
    setShownId(openId);
  }, [openId, items]);
  const shown = items.find((item) => item.pending_id === shownId) ?? null;

  return (
    <Screen>
      <MobileHeader title={WAITING_FOR_YOU} back large={false} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom, gap: 6 }}
      >
        {pending.isLoading ? <Text style={styles.meta}>Loading…</Text> : null}
        {pending.error ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.error}>{pending.error.message || "Could not load what is waiting."}</Text>
            <PrimaryButton label="Try again" onPress={() => void pending.refetch()} />
          </View>
        ) : null}
        {pending.data && items.length === 0 ? (
          <GroupHint>
            Nothing is waiting. When a chat reads something from outside Timely, what it learned waits here for you to keep or discard.
          </GroupHint>
        ) : null}
        {items.length ? (
          <ListGroup testID="waiting-list">
            {items.map((item) => (
              <ListRow
                key={item.pending_id}
                testID={`waiting-${item.pending_id}`}
                title={cardLine(item)}
                meta={pendingMeta(item)}
                leading={<Tile />}
                onPress={() => setShownId(item.pending_id)}
              />
            ))}
          </ListGroup>
        ) : null}
      </ScrollView>
      <PendingSheet
        item={shown}
        diffLoading={diffs.isLoading}
        diffMissing={!!diffs.data && !diffs.data.some((d) => d.pending_id === shown?.pending_id)}
        onClose={() => setShownId(null)}
      />
    </Screen>
  );
}

function PendingSheet({
  item: open,
  diffLoading,
  diffMissing,
  onClose,
}: {
  item: PendingView | null;
  diffLoading: boolean;
  diffMissing: boolean;
  onClose: () => void;
}) {
  const decide = useDecidePendingLearning();
  const last = useRef(open);
  if (open) last.current = open;
  const item = open ?? last.current;
  const offline = isOffline();
  const choose = (choice: "keep" | "discard") =>
    item && decide.mutate({ pendingIds: [item.pending_id], choice }, { onSuccess: onClose });
  const busy = decide.isPending;
  return (
    <BottomSheet
      open={!!open}
      onClose={onClose}
      title={item ? cardLine(item) : undefined}
      subtitle={item ? pendingMeta(item) : undefined}
      footer={
        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button
              testID="waiting-discard"
              label="Discard"
              variant="outline"
              stretch
              loading={busy && decide.variables?.choice === "discard"}
              disabled={offline || busy}
              onPress={() => choose("discard")}
            />
          </View>
          {diffMissing ? null : (
            <View style={{ flex: 1 }}>
              <Button
                testID="waiting-keep"
                label="Keep"
                stretch
                loading={busy && decide.variables?.choice === "keep"}
                disabled={offline || busy || diffLoading}
                onPress={() => choose("keep")}
              />
            </View>
          )}
        </View>
      }
    >
      {item ? (
        <View style={{ gap: 12 }} testID="waiting-sheet">
          <Text style={styles.meta}>{pendingWhy(item)}</Text>
          {item.diff ? (
            <Block label="What would change">
              <DiffBlock testID="waiting-diff" text={item.diff} />
            </Block>
          ) : diffLoading ? (
            <Text style={styles.meta}>Loading the change…</Text>
          ) : diffMissing ? (
            <Text testID="waiting-gone" style={styles.meta}>
              This change is no longer available. Discard it to clear it from the list.
            </Text>
          ) : null}
          {decide.error && decide.variables?.pendingIds[0] === item.pending_id ? (
            <Text style={styles.error}>{decide.error.message || "Could not save."}</Text>
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  meta: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  error: { color: colors.destructive, fontSize: 12, marginHorizontal: 4 },
  actions: { flexDirection: "row", gap: 8 },
}));
