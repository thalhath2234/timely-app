import { useState } from "react";
import ListEnter from "../../components/ui/ListEnter";
import { ChangeTint, StatNumber, useChangeKey } from "../../components/ui/motionKit";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronRight, Inbox, Sparkles, Trash2 } from "lucide-react-native";
import { inboxAge, inboxQueue, inboxSuggestionRows, inboxSuggestionSummary, skipInboxItem, type InboxAge } from "@timely/contract/inbox";
import Screen from "../../components/ui/Screen";
import MobileHeader from "../../components/ui/MobileHeader";
import EmptyState from "../../components/ui/EmptyState";
import { Button } from "../../components/ui/primitives";
import AnimatedPressable from "../../components/ui/AnimatedPressable";
import ConfirmSheet from "../../components/ui/ConfirmSheet";
import { LogoSpinner } from "../../components/ui/TimelyLogo";
import InboxCapture from "../../components/inbox/InboxCapture";
import { ListGroup, ListRow } from "../../components/settings/SettingsList";
import { useKeyboardCover } from "../../components/ui/useKeyboardCover";
import {
  useDecisionsStatusQuery,
  useDeleteTask,
  useInboxQuery,
  useInboxSuggestionsQuery,
  useWorkingHoursZone,
  useWorkspacesQuery,
} from "../../lib/hooks";
import { needsNetworkCopy } from "../../lib/queryCopy";
import ScreenTip from "../../components/ui/ScreenTip";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import type { Task } from "../../lib/types";

/** "Captured today", "Captured yesterday" or "Waiting 6 days". */
function upNextAge(age: InboxAge) {
  if (age.days === 0) return "Captured today";
  if (age.days === 1) return "Captured yesterday";
  return age.label;
}

/** What smart suggestions would make of the capture, and the tasks it might
 * duplicate to open and compare; the task screen applies it. */
function Suggestion({ task, onOpenTask }: { task: Task; onOpenTask: (id: string) => void }) {
  const status = useDecisionsStatusQuery();
  const on = status.data?.available === true;
  // Asked with suggestions off too: plain code still reads "Remind me…" and dates.
  const suggestions = useInboxSuggestionsQuery(task.id);
  const spaces = useWorkspacesQuery().data ?? [];
  const s = suggestions.data?.available ? suggestions.data : undefined;
  const workspaceName = s ? spaces.find((space) => space.id === s.workspaceId)?.name : undefined;
  const rows = inboxSuggestionRows(s, workspaceName);
  const summary = s ? inboxSuggestionSummary(s, workspaceName, task.id) : undefined;
  const thinking = on && suggestions.isLoading;
  return (
    <View style={{ gap: 10 }}>
      <ListGroup style={styles.rows}>
        {rows.map((row) => (
          <ListRow
            key={row.label}
            title={row.label}
            trailing={
              <Text numberOfLines={1} style={[styles.rowValue, row.suggested && styles.rowSuggested]}>
                {row.value}
                {row.suggested ? <Text style={styles.rowValue}> · suggested</Text> : null}
              </Text>
            }
            chevron={false}
          />
        ))}
      </ListGroup>
      {thinking ? (
        <View style={styles.suggestion}>
          <LogoSpinner size={14} />
          <Text style={styles.suggestionMuted}>Getting a suggestion…</Text>
        </View>
      ) : summary && (summary.note || summary.duplicates.length > 0) ? (
    <View style={styles.suggestion}>
      <Sparkles size={14} color={colors.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        {summary.note ? <Text style={styles.suggestionMuted}>{summary.note}</Text> : null}
        {summary.duplicates.length > 0 ? (
          <View style={{ gap: 6, marginTop: 2 }} testID="inbox-up-next-duplicates">
            <Text style={styles.suggestionMuted}>Might already exist:</Text>
            {summary.duplicates.map((dup) => (
              <AnimatedPressable
                key={dup.id}
                accessibilityRole="button"
                accessibilityLabel={`Open “${dup.name}”`}
                onPress={() => onOpenTask(dup.id)}
                style={styles.duplicate}
              >
                <Text style={styles.duplicateName} numberOfLines={1}>
                  {dup.name}
                </Text>
                <ChevronRight size={16} color={colors.mutedForeground} />
              </AnimatedPressable>
            ))}
            <Text style={styles.suggestionMuted}>Same thing? Delete this capture.</Text>
          </View>
        ) : null}
      </View>
    </View>
      ) : null}
    </View>
  );
}

export default function InboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const inbox = useInboxQuery();
  const remove = useDeleteTask();
  const zone = useWorkingHoursZone();
  // Android draws edge to edge, so the window no longer shrinks for the
  // keyboard: the screen lifts the composer itself, and drops the
  // gesture-bar gap while the keyboard is up.
  const keyboard = useKeyboardCover();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const items = inbox.data ?? [];
  const networkCopy = needsNetworkCopy(inbox);
  const { next, rest } = inboxQueue(items, skipped);
  const now = new Date();
  const oldest = items.length > 0 ? inboxAge(inboxQueue(items).next!.createdAt, now, zone) : null;
  const ages = items.map((item) => inboxAge(item.createdAt, now, zone));
  const review = (id: string) => router.push(`/(app)/tasks/${id}`);

  const subtitle =
    items.length === 0
      ? undefined
      : oldest && oldest.days > 1
        ? `${items.length} to review · oldest ${oldest.days} days`
        : `${items.length} to review`;

  return (
    <Screen>
      <MobileHeader title="Inbox" back subtitle={subtitle} />
      <View style={{ flex: 1, paddingBottom: keyboard }}>
        <ScrollView showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={inbox.isRefetching && !inbox.isPending}
              onRefresh={() => void inbox.refetch()}
              tintColor={colors.primary}
            />
          }
        >
          <ScreenTip screen="inbox" />
          {networkCopy && items.length === 0 ? (
            <EmptyState icon={Inbox} title="Couldn't load inbox" description={networkCopy} compact />
          ) : !next ? (
            <EmptyState
              icon={Inbox}
              loop="capture"
              title="Inbox zero"
              description="Nothing is waiting for a decision. Capture anything below and decide later: a thought becomes a task, a reminder or a note when you review it."
            />
          ) : (
            <>
              {(() => {
                const age = inboxAge(next.createdAt, now, zone);
                return (
                  <View style={styles.focus} testID="inbox-up-next">
                    <View style={{ gap: 4 }}>
                      <Text style={styles.eyebrow}>Up next · oldest capture</Text>
                      <Text style={styles.focusTitle}>{next.name}</Text>
                      <Text style={[styles.focusAge, age.stale && { color: colors.warning, fontWeight: "500" }]}>{upNextAge(age)}</Text>
                      {next.description ? (
                        <Text style={styles.focusNote} numberOfLines={2}>
                          {next.description}
                        </Text>
                      ) : null}
                    </View>
                    <Suggestion key={next.id} task={next} onOpenTask={review} />
                    <View style={styles.focusActions}>
                      <View style={{ flex: 1 }}>
                        <Button label="Review" stretch onPress={() => review(next.id)} />
                      </View>
                      {rest.length > 0 ? (
                        <Button
                          label="Later"
                          variant="outline"
                          onPress={() => setSkipped((current) => skipInboxItem(items, current, next.id))}
                        />
                      ) : null}
                      <Button
                        label={`Delete ${next.name}`}
                        variant="destructive-ghost"
                        iconOnly
                        icon={<Trash2 size={16} color={colors.destructive} />}
                        onPress={() => setDeleteItem({ id: next.id, name: next.name })}
                      />
                    </View>
                  </View>
                );
              })()}
              {rest.length > 0 ? (
                <>
                  <Text style={styles.section}>
                    Also waiting <Text style={styles.sectionCount}>{rest.length}</Text>
                  </Text>
                  <ListGroup testID="inbox-list">
                    {rest.map((task, index) => {
                      const age = inboxAge(task.createdAt, now, zone);
                      return (
                        <ListEnter key={task.id} index={index}>
                        <ListRow
                          title={task.name}
                          accessibilityLabel={`Review ${task.name}`}
                          onPress={() => review(task.id)}
                          onLongPress={() => setDeleteItem({ id: task.id, name: task.name })}
                          trailing={
                            age.days === 0 ? (
                              <View style={[styles.pill, { backgroundColor: `${colors.success}26` }]}>
                                <Text style={[styles.pillText, { color: colors.success }]}>NEW</Text>
                              </View>
                            ) : age.stale ? (
                              <View style={[styles.pill, { backgroundColor: `${colors.warning}26` }]}>
                                <Text style={[styles.pillText, { color: colors.warning }]}>{age.days} DAYS</Text>
                              </View>
                            ) : (
                              <Text style={styles.rowValue}>{age.label}</Text>
                            )
                          }
                        />
                        </ListEnter>
                      );
                    })}
                  </ListGroup>
                  <Text style={styles.hint}>Tap to review. Press and hold to delete.</Text>
                </>
              ) : null}
            </>
          )}
          {items.length > 0 ? (
            <View style={styles.tiles} testID="inbox-stats">
              {[
                { key: "fresh", value: ages.filter((age) => age.days === 0).length, label: "today", color: colors.success },
                { key: "recent", value: ages.filter((age) => age.days > 0 && !age.stale).length, label: "this week", color: colors.primary },
                { key: "stale", value: ages.filter((age) => age.stale).length, label: "stale", color: colors.warning },
              ].map((tile) => (
                <StatTile key={tile.key} value={tile.value} label={tile.label} color={tile.value > 0 ? tile.color : colors.mutedForeground} />
              ))}
            </View>
          ) : null}
        </ScrollView>
        <View style={[styles.composer, { paddingBottom: (keyboard > 0 ? 12 : Math.max(insets.bottom, 12)) + 4 }]}>
          <InboxCapture keepFocus compact />
        </View>
      </View>
      <ConfirmSheet
        open={deleteItem !== null}
        onClose={() => setDeleteItem(null)}
        title="Delete inbox item?"
        message={deleteItem ? `“${deleteItem.name}” will be permanently removed.` : undefined}
        onConfirm={() => {
          if (!deleteItem) return;
          remove.mutate(deleteItem.id, {
            onError: (cause) => Alert.alert("Could not delete item", cause instanceof Error ? cause.message : "Try again."),
          });
        }}
      />
    </Screen>
  );
}

/** One tile: the number pops and the tile tints when the count changes (catalogue items 3 and 8). */
function StatTile({ value, label, color }: { value: number; label: string; color: string }) {
  const changeKey = useChangeKey(value);
  return (
    <View style={[styles.tile, { overflow: "hidden" }]}>
      <ChangeTint changeKey={changeKey} />
      <StatNumber style={[styles.tileValue, { color }]} value={value} />
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { padding: 16, gap: 10, paddingBottom: 20 },
  section: { color: colors.foreground, fontSize: 13, fontWeight: "600", marginTop: 4 },
  sectionCount: { color: colors.mutedForeground, fontWeight: "400" },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, textAlign: "center" },
  focus: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
    shadowColor: colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  eyebrow: { color: colors.mutedForeground, fontSize: 11, fontWeight: "500", letterSpacing: 0.8, textTransform: "uppercase" },
  focusTitle: { color: colors.foreground, fontSize: 17, fontWeight: "600", lineHeight: 23, letterSpacing: -0.2 },
  focusAge: { color: colors.mutedForeground, fontSize: 12 },
  focusNote: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  focusActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  rows: { backgroundColor: colors.background },
  rowValue: { color: colors.mutedForeground, fontSize: 13, maxWidth: 200 },
  rowSuggested: { color: colors.primary, fontWeight: "500" },
  suggestion: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 2 },
  suggestionMuted: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  duplicate: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  duplicateName: { flex: 1, color: colors.foreground, fontSize: 13, fontWeight: "500" },
  pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  pillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  tiles: { flexDirection: "row", gap: 8, marginTop: 4 },
  tile: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  tileValue: { fontSize: 20, fontWeight: "600", letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  tileLabel: { flex: 1, color: colors.mutedForeground, fontSize: 12 },
  composer: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
    shadowColor: "#101828",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  },
}));
