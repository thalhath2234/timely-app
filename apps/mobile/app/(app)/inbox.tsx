import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Inbox } from "lucide-react-native";
import Screen from "../../components/ui/Screen";
import MobileHeader from "../../components/ui/MobileHeader";
import EmptyState from "../../components/ui/EmptyState";
import { Field, PrimaryButton } from "../../components/ui/primitives";
import { useCreateTask, useInboxQuery } from "../../lib/hooks";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export default function InboxScreen() {
  const router = useRouter();
  const inbox = useInboxQuery();
  const capture = useCreateTask();
  const [title, setTitle] = useState("");
  const items = inbox.data ?? [];

  return (
    <Screen>
      <MobileHeader title="Inbox" />
      <ScrollView contentContainerStyle={styles.body}>
        <Field value={title} onChangeText={setTitle} placeholder="Capture a title…" autoCapitalize="sentences" />
        <PrimaryButton
          label={capture.isPending ? "Saving…" : "Capture"}
          disabled={!title.trim() || capture.isPending}
          onPress={() => {
            const name = title.trim();
            if (!name) return;
            void capture.mutateAsync({ name, kind: "inbox" }).then(() => setTitle(""));
          }}
        />
        <Text style={styles.hint}>Inbox items are not auto-scheduled until you assign a workspace and duration.</Text>
        {capture.isError ? (
          <Text style={styles.error}>
            {capture.error instanceof Error ? capture.error.message : "Could not capture."}
          </Text>
        ) : null}
        {items.length === 0 ? (
          <EmptyState icon={Inbox} title="Inbox is empty" description="Capture a thought with only a title." compact />
        ) : (
          items.map((task) => (
            <Pressable
              key={task.id}
              onPress={() => router.push(`/(app)/tasks/${task.id}`)}
              style={styles.row}
            >
              <Text style={styles.title}>{task.name}</Text>
              <Text style={styles.meta}>Review</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
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
    justifyContent: "space-between",
    gap: 8,
  },
  title: { color: colors.foreground, fontSize: 15, flex: 1 },
  meta: { color: colors.mutedForeground, fontSize: 12 },
}));
