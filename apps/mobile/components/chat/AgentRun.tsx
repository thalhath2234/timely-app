import { Text, View } from "react-native";
import { Check, Sparkles, Undo2, X } from "lucide-react-native";
import { PERMISSION_COPY, type ActivityLine } from "@timely/contract/agentChat";
import type { Chat, ChatMessage } from "../../lib/chat/types";
import { appliedSteps, autoAppliedState, chatPermission } from "../../lib/chat/agentRun";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import { LogoSpinner } from "../ui/TimelyLogo";
import { ChatText } from "./shared";
import { phaseLabel } from "./chatMeta";

/** Lines shown before the rest fold into "N earlier". */
const SHOWN_LINES = 5;

function LineIcon({ state }: { state: ActivityLine["state"] }) {
  if (state === "running") return <LogoSpinner size={13} color={colors.primary} />;
  if (state === "failed") return <X size={13} color={colors.destructive} strokeWidth={2.5} />;
  return <Check size={13} color={colors.successText} strokeWidth={2.5} />;
}

/** A live run's activity lines: what it looked at and did, newest last. */
export function ActivityLines({ lines }: { lines: ActivityLine[] }) {
  if (!lines.length) return null;
  const hidden = Math.max(0, lines.length - SHOWN_LINES);
  return (
    <View style={styles.lines} testID="activity-lines" accessibilityLiveRegion="polite">
      {hidden ? <Text style={styles.earlier}>{hidden === 1 ? "1 earlier step" : `${hidden} earlier steps`}</Text> : null}
      {lines.slice(hidden).map((line) => (
        <View key={line.id} style={styles.line}>
          <View style={styles.lineIcon}>
            <LineIcon state={line.state} />
          </View>
          <Text numberOfLines={2} style={[styles.lineText, line.state === "failed" && { color: colors.destructive }]}>
            {line.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The agent run going on now: its activity lines and the reply as it is
 * written (Q-2.5). Replaces the classic "Thinking" card for agent runs.
 */
export function LiveRun({ chat, draft, onLink }: { chat: Chat; draft: string; onLink: (href: string) => void }) {
  const lines = chat.activity?.lines ?? [];
  return (
    <View style={styles.row} testID="live-run">
      <View style={styles.avatar}>
        <Sparkles size={14} color={colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
        <View style={styles.speakerRow}>
          <Text style={styles.speaker}>Timely</Text>
          <LogoSpinner size={12} color={colors.mutedForeground} />
          <Text style={styles.time}>{draft ? "Writing" : phaseLabel(chat.phase)}</Text>
        </View>
        <ActivityLines lines={lines} />
        {draft ? (
          <View testID="live-reply">
            <ChatText text={draft} onLink={onLink} />
          </View>
        ) : null}
        <Text style={styles.hint}>This keeps running on the server. Send a message to steer it, or Stop.</Text>
      </View>
    </View>
  );
}

/**
 * A proposal Auto or Full Access applied without asking: what it changed,
 * and Undo until it is undone (POST /chats/:id/undo).
 */
export function AutoAppliedCard({
  chat,
  message,
  undoing,
  onUndo,
}: {
  chat: Chat;
  message: ChatMessage;
  undoing: boolean;
  onUndo: (message: ChatMessage) => void;
}) {
  const state = autoAppliedState(message, chat);
  if (state === "none") return null;
  const steps = appliedSteps(chat, message).filter((step) => step.status === "done");
  const mode = PERMISSION_COPY[chatPermission(chat.permission) === "full" ? "full" : "auto"].name;
  const undone = state === "undone";
  return (
    <View style={styles.card} testID={undone ? "auto-applied-undone" : "auto-applied"}>
      <View style={styles.cardHead}>
        <Text style={styles.eyebrow}>{undone ? "Undone" : `Applied on its own · ${mode}`}</Text>
        {state === "undo" || state === "waiting" ? (
          <AnimatedPressable
            testID="undo-auto-applied"
            accessibilityRole="button"
            accessibilityLabel="Undo these changes"
            disabled={state === "waiting" || undoing}
            onPress={() => onUndo(message)}
            hitSlop={8}
            style={[styles.undo, (state === "waiting" || undoing) && { opacity: 0.45 }]}
          >
            {undoing ? <LogoSpinner size={14} color={colors.foreground} /> : <Undo2 size={14} color={colors.foreground} />}
            <Text style={styles.undoText}>Undo</Text>
          </AnimatedPressable>
        ) : null}
      </View>
      {steps.slice(0, 4).map((step, i) => (
        <View key={i} style={styles.line}>
          <View style={styles.lineIcon}>
            {undone ? <Undo2 size={13} color={colors.mutedForeground} /> : <Check size={13} color={colors.successText} strokeWidth={2.5} />}
          </View>
          <Text numberOfLines={2} style={[styles.lineText, undone && styles.struck]}>
            {step.summary}
          </Text>
        </View>
      ))}
      {steps.length > 4 ? <Text style={styles.earlier}>and {steps.length - 4} more</Text> : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  speakerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  speaker: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  time: { color: colors.mutedForeground, fontSize: 11 },
  lines: { gap: 6 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  lineIcon: { width: 16, height: 18, alignItems: "center", justifyContent: "center" },
  lineText: { flex: 1, color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  earlier: { color: colors.mutedForeground, fontSize: 12, paddingLeft: 24 },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  eyebrow: {
    flex: 1,
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  undo: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  undoText: { color: colors.foreground, fontSize: 13, fontWeight: "500" },
  struck: { textDecorationLine: "line-through" },
}));
