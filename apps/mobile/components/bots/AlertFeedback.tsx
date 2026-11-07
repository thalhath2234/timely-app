import { useState } from "react";
import { Text, View } from "react-native";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react-native";
import { FEEDBACK_REASONS, type AlertBrief, type FeedbackInput, type FeedbackReason } from "@timely/contract/bots";
import BottomSheet from "../ui/BottomSheet";
import { Button, Chip, Field, PrimaryButton } from "../ui/primitives";
import { useRateAlert } from "../../lib/hooks";
import { showUndoToast, useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";

const NOTE_MAX = 200;

/**
 * "Was it worth it?" on an alert: two equal buttons, Useful and Not useful,
 * and once rated only the chosen one with "You said this helped" beside it.
 * Not useful asks why on a sheet ("Why not?": three chips and an optional
 * line). The answer saves at once and the toast can take it back.
 */
export function AlertFeedback({ botId, alert }: { botId: string; alert: Pick<AlertBrief, "id" | "feedback"> }) {
  const rate = useRateAlert();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FeedbackReason>("");
  const [note, setNote] = useState("");

  const send = (body: FeedbackInput, thanks: string | null) =>
    rate.mutate(
      { botId, alertId: alert.id, body },
      {
        onSuccess: () => {
          setOpen(false);
          setReason("");
          setNote("");
          if (thanks)
            showUndoToast(thanks, () =>
              rate.mutate(
                { botId, alertId: alert.id, body: { feedback: null } },
                { onError: (error) => useToastStore.getState().show(error.message) },
              ),
            );
        },
        onError: (error) => useToastStore.getState().show(error.message),
      },
    );

  const useful = alert.feedback === "useful";
  const notUseful = alert.feedback === "not_useful";
  const rated = useful || notUseful;
  return (
    <View style={styles.wrap}>
      {rated ? (
        // Once rated, only the chosen answer with its note; tapping it takes
        // the answer back.
        <View style={styles.chosenRow}>
          <Button
            label={useful ? "Useful" : "Not useful"}
            variant="secondary"
            size="sm"
            disabled={rate.isPending}
            accessibilityLabel={`${useful ? "Useful" : "Not useful"}, chosen. Tap to take it back`}
            icon={<Check size={16} color={colors.foreground} />}
            onPress={() => send({ feedback: null }, null)}
          />
          <Text numberOfLines={1} style={styles.chosenNote}>
            {useful ? "You said this helped" : "You said it didn’t help"}
          </Text>
        </View>
      ) : (
        <View style={styles.row}>
          <View style={styles.half}>
            <Button
              label="Useful"
              variant="outline"
              size="sm"
              stretch
              disabled={rate.isPending}
              icon={<ThumbsUp size={16} color={colors.foreground} />}
              onPress={() => send({ feedback: "useful" }, "Saved: this alert helped")}
            />
          </View>
          <View style={styles.half}>
            <Button
              label="Not useful"
              variant="outline"
              size="sm"
              stretch
              disabled={rate.isPending}
              icon={<ThumbsDown size={16} color={colors.foreground} />}
              onPress={() => setOpen(true)}
            />
          </View>
        </View>
      )}
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Why not?"
        footer={
          <PrimaryButton
            label="Send"
            loading={rate.isPending}
            onPress={() => send({ feedback: "not_useful", reason, note: note.trim() }, "Saved: this alert didn’t help")}
          />
        }
      >
        <View style={styles.sheet}>
          <View style={styles.chips}>
            {FEEDBACK_REASONS.map((r) => (
              <Chip key={r.id} label={r.label} active={reason === r.id} onPress={() => setReason(reason === r.id ? "" : r.id)} />
            ))}
          </View>
          <Field
            label="Anything else? (optional)"
            value={note}
            onChangeText={(next) => setNote(next.slice(0, NOTE_MAX))}
            maxLength={NOTE_MAX}
            autoCapitalize="sentences"
          />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { gap: 6 },
  row: { flexDirection: "row", gap: 8 },
  half: { flex: 1, minWidth: 0 },
  chosenRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  chosenNote: { flex: 1, minWidth: 0, color: colors.mutedForeground, fontSize: 12 },
  sheet: { gap: 12, paddingBottom: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
}));
