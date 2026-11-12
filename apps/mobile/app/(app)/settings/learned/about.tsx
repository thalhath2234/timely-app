import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ABOUT_YOU, budgetMeter, type MemoryStore } from "@timely/contract/agentLearning";
import Screen from "../../../../components/ui/Screen";
import MobileHeader from "../../../../components/ui/MobileHeader";
import BottomSheet from "../../../../components/ui/BottomSheet";
import ConfirmSheet from "../../../../components/ui/ConfirmSheet";
import { Button, Field, PrimaryButton } from "../../../../components/ui/primitives";
import { GroupHint, ListGroup, ListRow } from "../../../../components/settings/SettingsList";
import { MeterRow, TextRow } from "../../../../components/settings/LearnedParts";
import { useAgentChatSettingsQuery, useEditLearnedMemory, useLearnedMemoryQuery } from "../../../../lib/hooks";
import { useLearningWatch } from "../../../../lib/chat/useLearningWatch";
import { canSaveEntry, engineLearningCopy, projectedBudget } from "../../../../lib/chat/learning";
import { isOffline } from "../../../../lib/networkState";
import { createThemedStyleSheet } from "../../../../lib/theme";

/** What is being edited: a new entry (old "") or an existing one. */
type Editing = { old: string } | null;

/**
 * About you (USER.md): what Timely knows about the person, read at the start
 * of every chat on the agent engine (never on Classic; the hint says so). Entries with the budget meter; add, edit, delete. Every
 * change also lands in Activity, with Undo.
 */
export default function AboutYou() {
  const insets = useSafeAreaInsets();
  const memory = useLearnedMemoryQuery();
  useLearningWatch();
  const store = memory.data?.user;
  const { aboutHint } = engineLearningCopy(useAgentChatSettingsQuery().data?.engine);
  const [editing, setEditing] = useState<Editing>(null);
  // Each open is a fresh sheet (its text starts from the entry); closing keeps it until it slides away.
  const [session, setSession] = useState(0);
  const open = (next: Editing) => {
    setSession((n) => n + 1);
    setEditing(next);
  };

  return (
    <Screen>
      <MobileHeader title={ABOUT_YOU} back large={false} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom, gap: 6 }}
      >
        {memory.isLoading ? <Text style={styles.meta}>Loading…</Text> : null}
        {memory.error ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.error}>{memory.error.message || "Could not load About you."}</Text>
            <PrimaryButton label="Try again" onPress={() => void memory.refetch()} />
          </View>
        ) : null}
        {store ? (
          <>
            <ListGroup>
              <MeterRow label="Space used" meter={budgetMeter(store.used, store.limit)} />
            </ListGroup>
            <GroupHint>{aboutHint}</GroupHint>
            <ListGroup testID="about-entries">
              {store.entries.map((entry, i) => (
                <TextRow key={`${i}:${entry}`} testID={`about-entry-${i}`} text={entry} onPress={() => open({ old: entry })} />
              ))}
              <ListRow testID="about-add" title="Add" tone="add" disabled={isOffline()} onPress={() => open({ old: "" })} />
            </ListGroup>
            {store.entries.length === 0 ? (
              <GroupHint>Nothing yet. Add what Timely should always know, like your role or how you like answers.</GroupHint>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <EntrySheet key={session} store={store} editing={editing} onClose={() => setEditing(null)} />
    </Screen>
  );
}

function EntrySheet({ store, editing, onClose }: { store: MemoryStore | undefined; editing: Editing; onClose: () => void }) {
  const edit = useEditLearnedMemory();
  // Kept while the sheet slides away, so its title does not change on close.
  const [old] = useState(editing?.old ?? "");
  const [text, setText] = useState(old);
  const [confirming, setConfirming] = useState(false);
  const meter = projectedBudget(store, old, text);
  const offline = isOffline();
  const save = () => {
    if (!editing) return;
    edit.mutate(
      old ? { target: "user", action: "replace", old, content: text.trim() } : { target: "user", action: "add", content: text.trim() },
      { onSuccess: onClose },
    );
  };
  return (
    <BottomSheet
      open={!!editing}
      onClose={onClose}
      title={old ? "Edit" : "Add to About you"}
      footer={
        <PrimaryButton
          testID="about-save"
          label="Save"
          loading={edit.isPending && edit.variables?.action !== "remove"}
          disabled={offline || !canSaveEntry(store, old, text)}
          onPress={save}
        />
      }
    >
      <View style={{ gap: 8 }}>
        <Field
          accessibilityLabel="About you entry"
          value={text}
          onChangeText={setText}
          placeholder="I run a small bakery and plan my week on Sundays"
          autoCapitalize="sentences"
          multiline
          autoGrow
          autoFocus
          maxLength={2200}
        />
        <Text style={[styles.meta, meter.tone === "full" && styles.full]}>{`${meter.text} characters`}</Text>
        {edit.error ? <Text style={styles.error}>{edit.error.message || "Could not save."}</Text> : null}
        {old ? (
          <Button
            testID="about-delete"
            label="Delete"
            variant="destructive-ghost"
            stretch
            disabled={offline || edit.isPending}
            onPress={() => setConfirming(true)}
          />
        ) : null}
      </View>
      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete this from About you?"
        message={old}
        confirmLabel="Delete"
        onConfirm={() => edit.mutate({ target: "user", action: "remove", old }, { onSuccess: onClose })}
      />
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  meta: { color: colors.mutedForeground, fontSize: 12, marginHorizontal: 4 },
  full: { color: colors.destructive },
  error: { color: colors.destructive, fontSize: 12, marginHorizontal: 4 },
}));
