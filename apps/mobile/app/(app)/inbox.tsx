import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Inbox, Trash2 } from "lucide-react-native";
import Screen from "../../components/ui/Screen";
import MobileHeader from "../../components/ui/MobileHeader";
import EmptyState from "../../components/ui/EmptyState";
import { Field, PrimaryButton } from "../../components/ui/primitives";
import AnimatedPressable from "../../components/ui/AnimatedPressable";
import ConfirmSheet from "../../components/ui/ConfirmSheet";
import { useCaptureInbox, useDeleteTask, useInboxQuery } from "../../lib/hooks";
import { needsNetworkCopy } from "../../lib/queryCopy";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export default function InboxScreen() {
  const router = useRouter();
  const inbox = useInboxQuery();
  const capture = useCaptureInbox();
  const remove = useDeleteTask();
  const [title, setTitle] = useState("");
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const items = inbox.data ?? [];
  const networkCopy = needsNetworkCopy(inbox);

  return (
    <Screen>
      <MobileHeader title="Inbox" back />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={inbox.isRefetching && !inbox.isPending}
            onRefresh={() => void inbox.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        <Field value={title} onChangeText={setTitle} placeholder="Capture a title…" autoCapitalize="sentences" />
        <PrimaryButton
          label={capture.isPending ? "Saving…" : "Capture"}
          disabled={!title.trim() || capture.isPending}
          onPress={() => {
            const name = title.trim();
            if (!name) return;
            void capture.mutateAsync(name).then(() => setTitle(""));
          }}
        />
        <Text style={styles.hint}>Inbox items are not auto-scheduled until you assign a workspace and duration.</Text>
        {capture.isError ? (
          <Text style={styles.error}>
            {capture.error instanceof Error ? capture.error.message : "Could not capture."}
          </Text>
        ) : null}
        {networkCopy && items.length === 0 ? (
          <EmptyState icon={Inbox} title="Couldn't load inbox" description={networkCopy} compact />
        ) : items.length === 0 ? (
          <EmptyState icon={Inbox} title="Inbox is empty" description="Capture a thought with only a title." compact />
        ) : (
          items.map((task) => (
            <View key={task.id} style={styles.row}>
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel={`Review ${task.name}`}
                onPress={() => router.push(`/(app)/tasks/${task.id}`)}
                style={styles.rowBody}
              >
                <Text style={[styles.title, task.completedAt ? styles.done : null]}>{task.name}</Text>
              </AnimatedPressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${task.name}`}
                onPress={() => setDeleteItem({ id: task.id, name: task.name })}
                style={styles.deleteButton}
              >
                <Trash2 size={18} color={colors.destructive} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
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
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  hint: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  error: { color: colors.destructive, fontSize: 13 },
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
  },
  rowBody: { flex: 1, minHeight: 48, justifyContent: "center" },
  deleteButton: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" },
  title: { color: colors.foreground, fontSize: 15, flex: 1 },
  done: { color: colors.mutedForeground, textDecorationLine: "line-through" },
}));
