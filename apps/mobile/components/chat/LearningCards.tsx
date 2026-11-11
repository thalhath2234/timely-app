import { Text, View } from "react-native";
import { Lightbulb, LightbulbOff, Undo2 } from "lucide-react-native";
import type { LearningChip as Chip, PendingCard } from "@timely/contract/agentLearning";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { cardMeta, DONT_LEARN, DONT_LEARN_META, NOT_LEARNING_LINE } from "../../lib/chat/learning";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet from "../ui/BottomSheet";
import { Button } from "../ui/primitives";
import { LogoSpinner } from "../ui/TimelyLogo";
import { GroupHint, ListGroup, SwitchRow } from "../settings/SettingsList";

/** A small text button inside the chip: "View", "Undo". */
function ChipAction({ label, onPress, disabled, testID }: { label: string; onPress?: () => void; disabled?: boolean; testID?: string }) {
  const off = disabled || !onPress;
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      disabled={off}
      hitSlop={8}
      onPress={onPress}
      style={[styles.chipAction, off && { opacity: 0.45 }]}
    >
      <Text style={styles.chipActionText}>{label}</Text>
    </AnimatedPressable>
  );
}

/**
 * The chip under an agent reply (plan 9b.4): "Learned: skill 'bank-csv-import'
 * created", "applies from your next chat" for memory, View and Undo; "Undone"
 * once every change of the turn is taken back.
 */
export function LearningChip({
  chip,
  undoing,
  onView,
  onUndo,
}: {
  chip: Chip;
  undoing: boolean;
  /** Missing when the change has nowhere to open on the phone. */
  onView?: () => void;
  /** Missing while offline: the chip still shows, with Undo off. */
  onUndo?: () => void;
}) {
  const undone = chip.actions.length === 0;
  return (
    <View testID={undone ? "learning-chip-undone" : "learning-chip"} style={styles.chip} accessibilityLabel={chip.text}>
      {undone ? <Undo2 size={14} color={colors.mutedForeground} /> : <Lightbulb size={14} color={colors.primary} />}
      <View style={styles.chipText}>
        <Text numberOfLines={2} style={[styles.chipLabel, undone && { color: colors.mutedForeground }]}>
          {chip.label}
        </Text>
        {chip.note ? <Text style={styles.chipNote}>{chip.note}</Text> : null}
      </View>
      {undone ? null : (
        <View style={styles.chipActions}>
          {onView ? <ChipAction testID="learning-view" label="View" onPress={onView} /> : null}
          {undoing ? (
            <LogoSpinner size={14} color={colors.foreground} />
          ) : (
            <ChipAction testID="learning-undo" label="Undo" onPress={onUndo} />
          )}
        </View>
      )}
    </View>
  );
}

/**
 * The Keep / Discard card after a reply whose changes wait (Q-3.1: the chat
 * read something from outside Timely, or a bot wrote it). Option 1's compact
 * "Keep what … learned?" row, then View diff, Discard and Keep.
 */
export function KeepCard({
  card,
  deciding,
  onDiff,
  onDecide,
}: {
  card: PendingCard;
  deciding: boolean;
  onDiff?: () => void;
  /** Missing while offline. */
  onDecide?: (choice: "keep" | "discard") => void;
}) {
  return (
    <View testID="learning-card" style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.tile}>
          <Lightbulb size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.cardTitle}>
            {card.title}
          </Text>
          <Text numberOfLines={2} style={styles.cardMeta}>
            {cardMeta(card)}
          </Text>
        </View>
      </View>
      {card.items.length === 1 && card.items[0].summary ? (
        <Text numberOfLines={3} style={styles.cardText}>
          {card.items[0].summary}
        </Text>
      ) : null}
      <Text style={styles.cardMeta}>{card.why}</Text>
      <View style={styles.cardActions}>
        {onDiff ? <Button testID="learning-diff" label={card.viewDiff} variant="ghost" size="sm" onPress={onDiff} /> : null}
        <View style={{ flex: 1 }} />
        <Button
          testID="learning-discard"
          label={card.discard}
          variant="outline"
          size="sm"
          disabled={deciding || !onDecide}
          onPress={() => onDecide?.("discard")}
        />
        <Button
          testID="learning-keep"
          label={card.keep}
          size="sm"
          loading={deciding}
          disabled={!onDecide}
          onPress={() => onDecide?.("keep")}
        />
      </View>
    </View>
  );
}

/** The thread's line while "Don't learn from this chat" is on. */
export function NotLearningLine() {
  return (
    <View testID="not-learning" style={styles.notice}>
      <LightbulbOff size={14} color={colors.mutedForeground} />
      <Text style={styles.noticeText}>{NOT_LEARNING_LINE}</Text>
    </View>
  );
}

/** The chat menu, opened from the chat's title: "Don't learn from this chat". */
export function ChatMenuSheet({
  open,
  onClose,
  title,
  noLearning,
  saving,
  onNoLearning,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  noLearning: boolean;
  saving: boolean;
  onNoLearning: (next: boolean) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="This chat" subtitle={title}>
      <View style={{ gap: 6 }} testID="chat-menu">
        <ListGroup>
          <SwitchRow
            title={DONT_LEARN}
            value={noLearning}
            onChange={(next) => {
              if (!saving) onNoLearning(next);
            }}
          />
        </ListGroup>
        <GroupHint>{DONT_LEARN_META}</GroupHint>
      </View>
    </BottomSheet>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  chip: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: colors.muted,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  chipText: { flexShrink: 1, minWidth: 0 },
  chipLabel: { color: colors.foreground, fontSize: 13, fontWeight: "500", lineHeight: 18 },
  chipNote: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  chipActions: { flexDirection: "row", alignItems: "center", gap: 12, marginLeft: 2 },
  chipAction: { minHeight: 24, justifyContent: "center" },
  chipActionText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: `${colors.primary}1a`,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { color: colors.foreground, fontSize: 15, fontWeight: "500", lineHeight: 20 },
  cardMeta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  cardText: { color: colors.foreground, fontSize: 13, lineHeight: 18 },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  notice: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center" },
  noticeText: { color: colors.mutedForeground, fontSize: 12 },
}));
