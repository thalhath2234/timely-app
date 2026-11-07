import { useState } from "react";
import { Text, View } from "react-native";
import { ThumbsDown, Unlink } from "lucide-react-native";
import { PASS_FEEDBACK, howItCame, type AlertView, type BotView, type LinkView } from "@timely/contract/bots";
import BottomSheet from "../ui/BottomSheet";
import ConfirmSheet from "../ui/ConfirmSheet";
import { GroupHint, ListGroup, ListRow } from "../settings/SettingsList";
import { useBotsQuery, useRateAlert, useSetLink } from "../../lib/hooks";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";

const say = (message: string) => useToastStore.getState().show(message);

/**
 * "How this came to you" for an alert in the open bot: which bots found and
 * passed it on, which bot checked it, and whether AI judged it, as on the
 * web. An alert that came through a link that is still on can be marked
 * "Shouldn't have been passed on", or that pass turned off (asked first).
 */
export function HowItCameSheet({
  open,
  onClose,
  bot,
  alert,
  links,
}: {
  open: boolean;
  onClose: () => void;
  bot: Pick<BotView, "id" | "name">;
  alert: Pick<AlertView, "id" | "via" | "aiState" | "feedback" | "feedbackReason">;
  links: LinkView[] | null | undefined;
}) {
  const bots = useBotsQuery().data?.bots;
  const rate = useRateAlert();
  const setLink = useSetLink();
  const [confirm, setConfirm] = useState(false);

  const { rows, unpass } = howItCame(alert, bot, bots, links);
  const link = unpass ? (links ?? []).find((l) => l.id === unpass.linkId) : undefined;
  const from = (link && bots?.find((b) => b.id === link.fromBotId)?.name) || "the bot";
  // Only a Not useful for this reason; another reason can still be changed to it.
  const marked = alert.feedback === "not_useful" && alert.feedbackReason === PASS_FEEDBACK.id;

  const notPassed = () =>
    rate.mutate(
      { botId: bot.id, alertId: alert.id, body: { feedback: "not_useful", reason: PASS_FEEDBACK.id } },
      { onSuccess: onClose, onError: (error) => say(error.message) },
    );

  const turnOff = async () => {
    if (!unpass) return;
    try {
      await setLink.mutateAsync({ linkId: unpass.linkId, enabled: false });
      say("Pass turned off");
      onClose();
    } catch (error) {
      say(error instanceof Error ? error.message : "Could not turn the pass off");
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="How this came to you">
      <View style={styles.body}>
        <ListGroup>
          {rows.map(([label, value], i) => (
            <ListRow
              key={`${i}-${label}`}
              title={label}
              trailing={
                <Text numberOfLines={2} style={styles.value}>
                  {value}
                </Text>
              }
            />
          ))}
        </ListGroup>
        {unpass ? (
          <>
            <ListGroup>
              <ListRow
                title={PASS_FEEDBACK.label}
                meta={marked ? "You said this" : undefined}
                leading={<ThumbsDown size={18} color={colors.foreground} />}
                chevron={false}
                disabled={marked || rate.isPending}
                onPress={notPassed}
              />
              <ListRow
                title="Turn off this pass"
                tone="danger"
                leading={<Unlink size={18} color={colors.destructive} />}
                disabled={setLink.isPending}
                onPress={() => setConfirm(true)}
              />
            </ListGroup>
            <GroupHint>{`${from} passed this on for ${bot.name} to check before telling you.`}</GroupHint>
          </>
        ) : null}
      </View>
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Stop ${from} passing items to ${bot.name}?`}
        message="Its finds then come straight to you again. You can turn the pass back on from either bot."
        confirmLabel="Turn off"
        onConfirm={turnOff}
      />
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  body: { gap: 12, paddingTop: 4, paddingBottom: 4 },
  value: { flexShrink: 1, maxWidth: "62%", textAlign: "right", color: colors.mutedForeground, fontSize: 13, fontWeight: "500" },
}));
