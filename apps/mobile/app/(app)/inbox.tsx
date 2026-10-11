import { useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Clock, Inbox, Sparkles, Trash2 } from "lucide-react-native";
import { inboxAge, inboxQueue, inboxSuggestionSummary, skipInboxItem, type InboxAge } from "@timely/contract/inbox";
import Screen from "../../components/ui/Screen";
import MobileHeader from "../../components/ui/MobileHeader";
import EmptyState from "../../components/ui/EmptyState";
import { Button } from "../../components/ui/primitives";
import AnimatedPressable from "../../components/ui/AnimatedPressable";
import ConfirmSheet from "../../components/ui/ConfirmSheet";
import { LogoSpinner } from "../../components/ui/TimelyLogo";
import {
  useCaptureInbox,
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

/** What smart suggestions would make of the capture; the task screen applies it. */
function Suggestion({ task }: { task: Task }) {
  const status = useDecisionsStatusQuery();
  const on = status.data?.available === true;
  const suggestions = useInboxSuggestionsQuery(task.id, on);
  const spaces = useWorkspacesQuery().data ?? [];
  if (!on) return null;
  if (suggestions.isLoading) {
    return (
      <View style={styles.suggestion}>
        <LogoSpinner size={14} />
        <Text style={styles.suggestionMuted}>Getting a suggestion…</Text>
      </View>
    );
  }
  const s = suggestions.data?.available ? suggestions.data : undefined;
  if (!s) return null;
  const summary = inboxSuggestionSummary(s, spaces.find((space) => space.id === s.workspaceId)?.name);
  if (!summary.line && !summary.note) return null;
  return (
    <View style={styles.suggestion}>
      <Sparkles size={16} color={colors.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        {summary.line ? (
          <Text style={styles.suggestionText}>
            <Text style={{ fontWeight: "600" }}>Suggested: </Text>
            {summary.line}. Review to apply it.
          </Text>
        ) : null}
        {summary.note ? <Text style={styles.suggestionMuted}>{summary.note}</Text> : null}
      </View>
    </View>
  );
}

export default function InboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const inbox = useInboxQuery();
  const capture = useCaptureInbox();
  const remove = useDeleteTask();
  const zone = useWorkingHoursZone();
  const [title, setTitle] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const inputRef = useRef<TextInput>(null);
  const items = inbox.data ?? [];
  const networkCopy = needsNetworkCopy(inbox);
  const { next, rest } = inboxQueue(items, skipped);
  const now = new Date();
  const oldest = items.length > 0 ? inboxAge(inboxQueue(items).next!.createdAt, now, zone) : null;
  const review = (id: string) => router.push(`/(app)/tasks/${id}`);

  const onCapture = () => {
    const name = title.trim();
    if (!name) return;
    void capture.mutateAsync(name).then(() => {
      setTitle("");
      inputRef.current?.focus();
    });
  };

  const subtitle =
    items.length === 0
      ? undefined
      : oldest && oldest.days > 1
        ? `${items.length} to review · oldest ${oldest.days} days`
        : `${items.length} to review`;

  return (
    <Screen>
      <MobileHeader title="Inbox" back subtitle={subtitle} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
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
              title="Inbox zero"
              description="Nothing is waiting for a decision. Capture anything below and decide later."
              compact
            />
          ) : (
            <>
              <Text style={styles.section}>Up next</Text>
              {(() => {
                const age = inboxAge(next.createdAt, now, zone);
                return (
                  <View style={styles.focus} testID="inbox-up-next">
                    <View style={[styles.chip, age.stale && styles.chipStale]}>
                      <Clock size={13} color={age.stale ? colors.warning : colors.mutedForeground} />
                      <Text style={[styles.chipText, age.stale && { color: colors.foreground }]}>
                        {upNextAge(age)}
                      </Text>
                    </View>
                    <View style={{ gap: 6 }}>
                      <Text style={styles.focusTitle}>{next.name}</Text>
                      {next.description ? (
                        <Text style={styles.focusNote} numberOfLines={2}>
                          {next.description}
                        </Text>
                      ) : null}
                    </View>
                    <Suggestion key={next.id} task={next} />
                    <View style={styles.focusActions}>
                      <View style={{ flex: 1 }}>
                        <Button label="Review" size="lg" stretch onPress={() => review(next.id)} />
                      </View>
                      {rest.length > 0 ? (
                        <Button
                          label="Later"
                          variant="outline"
                          size="lg"
                          onPress={() => setSkipped((current) => skipInboxItem(items, current, next.id))}
                        />
                      ) : null}
                      <Button
                        label={`Delete ${next.name}`}
                        variant="destructive-ghost"
                        size="lg"
                        iconOnly
                        icon={<Trash2 size={18} color={colors.destructive} />}
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
                  <View style={styles.grid}>
                    {rest.map((task) => {
                      const age = inboxAge(task.createdAt, now, zone);
                      return (
                        <AnimatedPressable
                          key={task.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Review ${task.name}`}
                          onPress={() => review(task.id)}
                          onLongPress={() => setDeleteItem({ id: task.id, name: task.name })}
                          wrapStyle={styles.cellWrap}
                          style={[styles.cell, age.stale && styles.cellStale]}
                        >
                          <View style={styles.cellAge}>
                            {age.stale ? <View style={styles.staleDot} /> : null}
                            <Text
                              style={[
                                styles.cellAgeText,
                                age.days === 0 && { color: colors.success },
                                age.stale && { color: colors.foreground },
                              ]}
                            >
                              {age.days === 0 ? "New today" : age.stale ? `${age.days} days` : age.label}
                            </Text>
                          </View>
                          <Text style={styles.cellTitle} numberOfLines={3}>
                            {task.name}
                          </Text>
                        </AnimatedPressable>
                      );
                    })}
                  </View>
                  <Text style={styles.hint}>Tap a card to review it. Press and hold to delete.</Text>
                </>
              ) : null}
            </>
          )}
        </ScrollView>
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
          <Text style={styles.composerLabel}>What&apos;s on your mind?</Text>
          <TextInput
            ref={inputRef}
            value={title}
            onChangeText={setTitle}
            placeholder="Capture a thought…"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={onCapture}
            submitBehavior="submit"
            accessibilityLabel="Capture to inbox"
            style={styles.composerInput}
          />
          <View style={styles.composerRow}>
            <Text style={[styles.hint, { flex: 1, textAlign: "left" }]} numberOfLines={2}>
              {capture.isError
                ? capture.error instanceof Error
                  ? capture.error.message
                  : "Could not capture."
                : "Nothing is scheduled until you decide."}
            </Text>
            <Button label="Capture" size="lg" loading={capture.isPending} disabled={!title.trim()} onPress={onCapture} />
          </View>
        </View>
      </KeyboardAvoidingView>
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

const styles = createThemedStyleSheet((colors) => ({
  body: { padding: 16, gap: 10, paddingBottom: 24 },
  section: { color: colors.foreground, fontSize: 13, fontWeight: "600", marginTop: 4 },
  sectionCount: { color: colors.mutedForeground, fontWeight: "400" },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, textAlign: "center" },
  focus: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    shadowColor: colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  chip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.muted,
  },
  chipStale: { backgroundColor: `${colors.warning}26` },
  chipText: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  focusTitle: { color: colors.foreground, fontSize: 19, fontWeight: "600", lineHeight: 25, letterSpacing: -0.2 },
  focusNote: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  focusActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  suggestion: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${colors.primary}33`,
    backgroundColor: `${colors.primary}0D`,
  },
  suggestionText: { color: colors.accentForeground, fontSize: 13, lineHeight: 19 },
  suggestionMuted: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cellWrap: { flexBasis: "45%", flexGrow: 1 },
  cell: {
    minHeight: 100,
    padding: 12,
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  cellStale: { borderColor: `${colors.warning}66`, backgroundColor: `${colors.warning}0A` },
  cellAge: { flexDirection: "row", alignItems: "center", gap: 6 },
  staleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning },
  cellAgeText: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  cellTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600", lineHeight: 19 },
  composer: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 8,
    shadowColor: "#101828",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  },
  composerLabel: { color: colors.mutedForeground, fontSize: 12, fontWeight: "500" },
  composerInput: { color: colors.foreground, fontSize: 18, fontWeight: "500", paddingVertical: 4 },
  composerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
}));
