import { Text, View } from "react-native";
import {
  Check,
  ClipboardList,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react-native";
import type { Chat, ChatStep } from "../../lib/chat/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import ChangeCards from "./ChangeCards";
import { ReceiptSaveSummary } from "./ReceiptReview";
import { isBusy, phaseLabel } from "./chatMeta";
import { Action, styles as common } from "./shared";

/**
 * Full-page review of the live plan (or an archived one via `steps`). Receipt
 * confirmations show the saved summary first and the sheet changes underneath.
 */
export default function ProposalPage({
  chat,
  steps,
  archived,
  receiptConfirmation,
  receiptDirty,
  locked,
  pending,
  offline,
  act,
  onLink,
  onEditReceipt,
}: {
  chat: Chat;
  steps: ChatStep[];
  archived: boolean;
  receiptConfirmation: boolean;
  receiptDirty: boolean;
  locked: boolean;
  pending: boolean;
  offline: boolean;
  act: (action: string, body?: unknown) => void;
  onLink: (href: string) => void;
  onEditReceipt: () => void;
}) {
  const done = steps.filter((s) => s.status === "done").length;
  const busy = isBusy(chat.status);
  const applying = !archived && busy && chat.phase === "apply";
  const activeIndex = applying
    ? steps.findIndex((s) => s.status !== "done")
    : -1;
  const complete = steps.length > 0 && done === steps.length;
  const failed = !archived && chat.status === "failed";
  const stopped = !archived && chat.status === "stopped";
  const approval = !archived && chat.status === "approval";
  const heading = archived
    ? "Earlier changes"
    : approval
      ? receiptConfirmation
        ? "Confirm and save"
        : "Ready for your review"
      : applying
        ? "Applying changes"
        : failed
          ? "Some changes did not finish"
          : stopped
            ? "Stopped before finishing"
            : complete
              ? "Changes applied"
              : "Your changes";
  const hint = approval
    ? receiptDirty
      ? "Receipt details changed. Go back and continue again to refresh this preview."
      : receiptConfirmation
        ? "Saving removes the temporary photos. Extracted details stay with the receipt."
        : "Nothing is saved until you apply. To adjust, go back and reply."
    : failed
      ? "Finished changes are kept. Retry continues from the first unfinished step."
      : stopped
        ? "Completed changes are kept. Resume to review what is left."
        : applying
          ? "You can close the assistant; progress is saved as it goes."
          : "";
  const tone = approval
    ? colors.warning
    : failed
      ? colors.destructive
      : complete
        ? colors.success
        : colors.primary;
  return (
    <View style={{ gap: 16 }}>
      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <View style={[styles.summaryIcon, { backgroundColor: `${tone}1f` }]}>
            {complete ? (
              <Check size={20} color={tone} />
            ) : (
              <ClipboardList size={20} color={tone} />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.heading}>{heading}</Text>
            <Text style={common.muted}>
              {done} of {steps.length}{" "}
              {steps.length === 1 ? "change" : "changes"} applied
              {applying ? ` · ${phaseLabel(chat.phase)}` : ""}
            </Text>
          </View>
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: steps.length, now: done }}
          style={styles.track}
        >
          <View
            style={[
              styles.fill,
              {
                width: `${steps.length ? (done / steps.length) * 100 : 0}%`,
                backgroundColor: failed ? colors.destructive : colors.primary,
              },
            ]}
          />
        </View>
        {hint ? <Text style={common.muted}>{hint}</Text> : null}
        {applying ? (
          <Action
            label="Stop"
            icon={Square}
            compact
            disabled={pending || offline}
            onPress={() => act("/stop")}
          />
        ) : null}
      </View>
      {receiptConfirmation &&
      chat.imageReview?.receipt &&
      chat.imageReview.destination ? (
        <ReceiptSaveSummary
          receipt={chat.imageReview.receipt}
          destination={chat.imageReview.destination}
        />
      ) : null}
      {approval ? (
        <View style={{ gap: 10 }}>
          <Action
            label={receiptConfirmation ? "Save receipt" : "Apply changes"}
            icon={Check}
            primary
            disabled={locked || receiptDirty}
            onPress={() => act("/approve", { revision: chat.revision })}
          />
          <View style={styles.secondaryRow}>
            {receiptConfirmation ? (
              <View style={{ flex: 1 }}>
                <Action
                  label="Edit receipt"
                  compact
                  disabled={locked}
                  onPress={onEditReceipt}
                />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Action
                label="Discard proposal"
                icon={Trash2}
                tone="destructive"
                compact
                disabled={locked}
                onPress={() => act("/reject", { revision: chat.revision })}
              />
            </View>
          </View>
        </View>
      ) : null}
      {failed || stopped ? (
        <Action
          label={
            chat.phase === "apply" ? "Review unfinished changes" : "Try again"
          }
          icon={RefreshCw}
          primary
          disabled={locked}
          onPress={() => act("/retry")}
        />
      ) : null}
      {failed && chat.error ? (
        <Text style={styles.error}>{chat.error}</Text>
      ) : null}
      <Text style={styles.sectionLabel}>
        {receiptConfirmation ? "Sheet changes" : "Changes"}
      </Text>
      <ChangeCards
        steps={steps}
        onLink={onLink}
        activeIndex={activeIndex}
        muted={archived}
      />
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  summary: {
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    color: colors.foreground,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.muted,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 3 },
  secondaryRow: { flexDirection: "row", gap: 10 },
  error: { color: colors.destructive, fontSize: 14, lineHeight: 20 },
  sectionLabel: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
    marginTop: 4,
  },
}));
