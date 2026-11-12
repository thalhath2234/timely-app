import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ABOUT_YOU,
  ACTIVITY,
  LEARNED_TITLE,
  LEARN_SWITCH,
  NEVER_ARCHIVES,
  WAITING_FOR_YOU,
  budgetMeter,
} from "@timely/contract/agentLearning";
import Screen from "../../../../components/ui/Screen";
import MobileHeader from "../../../../components/ui/MobileHeader";
import { PrimaryButton } from "../../../../components/ui/primitives";
import {
  GroupHint,
  GroupLabel,
  ListGroup,
  ListRow,
  ListSwitch,
  SwitchRow,
} from "../../../../components/settings/SettingsList";
import {
  useLearnedMemoryQuery,
  useLearningSettingsQuery,
  usePatchLearningSettings,
  usePendingLearningQuery,
} from "../../../../lib/hooks";
import {
  ABOUT_YOU_ROUTE,
  ACTIVITY_ROUTE,
  SEARCH_NEEDS_LEARNING,
  SKILLS_ON_COMPUTER,
  WAITING_ROUTE,
} from "../../../../lib/chat/learning";
import { useLearningWatch } from "../../../../lib/chat/useLearningWatch";
import { createThemedStyleSheet } from "../../../../lib/theme";

/**
 * Settings → Agent → What Timely learned on the phone (plan 9b.4): the
 * Learning and "Search my past chats" switches, then Waiting for you, About
 * you and Activity. Skills are managed on web and desktop.
 */
export default function LearnedSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const settings = useLearningSettingsQuery();
  const patch = usePatchLearningSettings();
  useLearningWatch();
  const ready = !!settings.data;
  const memory = useLearnedMemoryQuery(ready);
  const pending = usePendingLearningQuery(ready);
  const data = settings.data;
  const waiting = pending.data?.length ?? 0;
  const about = memory.data?.user;

  return (
    <Screen>
      <MobileHeader title={LEARNED_TITLE} back large={false} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom, gap: 6 }}
      >
        {settings.isLoading ? <Text style={styles.meta}>Loading…</Text> : null}
        {settings.error ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.error}>{settings.error.message || "Could not load what Timely learned."}</Text>
            <PrimaryButton label="Try again" onPress={() => void settings.refetch()} />
          </View>
        ) : null}
        {data ? (
          <>
            <ListGroup testID="learned-switches">
              <SwitchRow
                title={LEARN_SWITCH}
                meta="Timely remembers what helps, from your chats"
                value={data.learning}
                onChange={(learning) => patch.mutate({ learning })}
              />
              <ListRow
                title="Search my past chats"
                meta="Timely can look back at earlier chats"
                action={
                  <ListSwitch
                    label="Search my past chats"
                    value={data.learning && data.searchHistory}
                    disabled={!data.learning}
                    onChange={(searchHistory) => patch.mutate({ searchHistory })}
                  />
                }
              />
            </ListGroup>
            {patch.error ? (
              <Text style={styles.error}>{patch.error.message || "Could not save."}</Text>
            ) : !data.learning ? (
              <GroupHint>{SEARCH_NEEDS_LEARNING}</GroupHint>
            ) : null}

            <GroupLabel>What it knows</GroupLabel>
            <ListGroup testID="learned-sections">
              <ListRow
                testID="learned-waiting"
                title={WAITING_FOR_YOU}
                // Nothing while the list loads (the worker may be starting): "None" only for an empty list.
                trailing={waiting ? String(waiting) : pending.data ? "None" : undefined}
                onPress={() => router.push(WAITING_ROUTE)}
              />
              <ListRow
                testID="learned-about"
                title={ABOUT_YOU}
                trailing={about ? budgetMeter(about.used, about.limit).text : undefined}
                onPress={() => router.push(ABOUT_YOU_ROUTE)}
              />
              <ListRow testID="learned-activity" title={ACTIVITY} onPress={() => router.push(ACTIVITY_ROUTE)} />
            </ListGroup>
            <GroupHint>
              {SKILLS_ON_COMPUTER} {NEVER_ARCHIVES}
            </GroupHint>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  meta: { color: colors.mutedForeground, fontSize: 13 },
  error: { color: colors.destructive, fontSize: 12, marginHorizontal: 4 },
}));
