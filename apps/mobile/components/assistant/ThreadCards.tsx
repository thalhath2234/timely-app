import { Linking, Text, View } from "react-native";
import { ArrowUpRight, Bell, MessageSquare, ShieldAlert, Undo2 } from "lucide-react-native";
import { botPermissionNote, changedLine, hostOf } from "@timely/contract/bots";
import AnimatedPressable from "../ui/AnimatedPressable";
import { Button } from "../ui/primitives";
import { ListGroup, ListRow } from "../settings/SettingsList";
import type { BotThreadLine } from "../../lib/api/chat";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import { gateWords, permissionWords, promptPreview, scheduleWords, skillsSummary, toolsSummary } from "../bots/agentBot";
import { alertIsHeld, heldWords } from "./inbox";

type Line<K extends BotThreadLine["kind"]> = Extract<BotThreadLine, { kind: K }>;

/** What a change that widens the Bot is held for, in words. */
export const PENDING_REASON: Record<Line<"pending_change">["reason"], string> = {
  browser_site: "A new signed-in site",
  memory: "Memory and About you on",
  permission: "A looser permission",
};

/** The person's own message: right-aligned, in the accent. */
export function UserBubble({ text }: { text: string }) {
  return (
    <View style={styles.userRow}>
      <View style={styles.user}>
        <Text style={styles.userText}>{text}</Text>
      </View>
    </View>
  );
}

/** The Bot's answer from its own history. */
export function AnswerBubble({ text }: { text: string }) {
  return (
    <View style={styles.answer}>
      <Text selectable style={styles.body}>
        {text}
      </Text>
    </View>
  );
}

/**
 * An alert posted into the thread: its text, Do this in chat, and when the
 * run proposed a Timely write, its Review card (nothing applies until Approve).
 */
export function AlertCard({
  item,
  busy,
  held,
  onDoInChat,
  onReview,
  onOpenReceipt,
}: {
  item: Line<"alert">;
  busy: boolean;
  /** The alert's held state when known ("duplicate" reads "Already told you"). */
  held?: string | null;
  onDoInChat: () => void;
  onReview: (action: "approve" | "discard") => void;
  onOpenReceipt: (conversationId: string) => void;
}) {
  const note = heldWords(held);
  const muted = alertIsHeld(held);
  const review = item.review;
  return (
    <View style={[styles.card, muted && styles.muted]}>
      <View style={styles.head}>
        <Bell size={14} color={muted ? colors.mutedForeground : colors.primary} />
        <Text style={styles.eyebrow}>Alert</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      <Text style={styles.title}>{item.title}</Text>
      {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
      {item.url ? (
        <AnimatedPressable accessibilityRole="link" accessibilityLabel={`Open ${hostOf(item.url) || item.url}`} onPress={() => void Linking.openURL(item.url as string)} style={styles.link}>
          <ArrowUpRight size={14} color={colors.primary} />
          <Text numberOfLines={1} style={styles.linkText}>
            {hostOf(item.url) || item.url}
          </Text>
        </AnimatedPressable>
      ) : null}
      {review ? <ReviewCard review={review} busy={busy} onReview={onReview} onOpenReceipt={onOpenReceipt} /> : null}
      <View style={styles.actions}>
        <Button
          label="Do this in chat"
          variant="outline"
          size="sm"
          icon={<MessageSquare size={16} color={colors.foreground} />}
          disabled={busy}
          onPress={onDoInChat}
        />
      </View>
    </View>
  );
}

const REVIEW_STATE: Record<string, string> = {
  approved: "Approved, applying",
  applied: "Applied",
  dismissed: "Not applied",
  undone: "Undone",
  failed: "Could not apply",
};

/** A change the run proposed. It applies only when approved, with a receipt and Undo. */
function ReviewCard({
  review,
  busy,
  onReview,
  onOpenReceipt,
}: {
  review: NonNullable<Line<"alert">["review"]>;
  busy: boolean;
  onReview: (action: "approve" | "discard") => void;
  onOpenReceipt: (conversationId: string) => void;
}) {
  const waiting = review.state === "pending";
  return (
    <View style={styles.review}>
      <Text style={styles.eyebrow}>Review</Text>
      {review.summary ? <Text style={styles.title}>{review.summary}</Text> : null}
      {review.steps.length ? (
        <ListGroup>
          {review.steps.map((step, i) => (
            <ListRow key={`${i}-${step}`} title={step} chevron={false} />
          ))}
        </ListGroup>
      ) : null}
      {waiting ? (
        <View style={styles.actions}>
          <Button label="Approve" size="sm" disabled={busy} onPress={() => onReview("approve")} />
          <Button label="Discard" variant="outline" size="sm" disabled={busy} onPress={() => onReview("discard")} />
        </View>
      ) : (
        <View style={styles.actions}>
          <Text style={styles.note}>{REVIEW_STATE[review.state] ?? review.state}</Text>
          {review.conversationId ? (
            <Button
              label="Receipt and Undo"
              variant="ghost"
              size="sm"
              icon={<Undo2 size={16} color={colors.foreground} />}
              onPress={() => onOpenReceipt(review.conversationId as string)}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

/** "Changed: X -> Y" with Undo; the model's own undo can never widen a Bot, the tap can. */
export function ChangeCard({ item, busy, onUndo }: { item: Line<"change">; busy: boolean; onUndo: () => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.body}>{changedLine(item.before, item.after)}</Text>
      <View style={styles.actions}>
        {item.undone ? (
          <Text style={styles.note}>Undone</Text>
        ) : (
          <Button label="Undo" variant="outline" size="sm" icon={<Undo2 size={16} color={colors.foreground} />} disabled={busy} onPress={onUndo} />
        )}
      </View>
    </View>
  );
}

/** A change that gives the Bot more reach waits here for one tap. */
export function PendingCard({
  item,
  busy,
  onResolve,
}: {
  item: Line<"pending_change">;
  busy: boolean;
  onResolve: (action: "approve" | "discard") => void;
}) {
  const waiting = !item.state || item.state === "pending";
  return (
    <View style={[styles.card, styles.pending]}>
      <View style={styles.head}>
        <ShieldAlert size={14} color={colors.warningText} />
        <Text style={styles.eyebrow}>Needs one tap</Text>
      </View>
      <Text style={styles.title}>{PENDING_REASON[item.reason] ?? "More reach"}</Text>
      <Text style={styles.body}>{changedLine(item.before, item.after)}</Text>
      {waiting ? (
        <View style={styles.actions}>
          <Button label="Approve" size="sm" disabled={busy} onPress={() => onResolve("approve")} />
          <Button label="Not now" variant="outline" size="sm" disabled={busy} onPress={() => onResolve("discard")} />
        </View>
      ) : (
        <Text style={styles.note}>{item.state === "done" || item.state === "approved" ? "Approved" : "Not now"}</Text>
      )}
    </View>
  );
}

/** A new Bot's whole setup, shown for one Create. */
export function DraftSetupCard({
  item,
  busy,
  onCreate,
}: {
  item: Line<"draft_setup">;
  busy: boolean;
  onCreate: () => void;
}) {
  const f = item.fields;
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>New Bot</Text>
      <Text style={styles.title}>{item.name}</Text>
      <ListGroup>
        {/* A wrapped subtitle gets the same 14 pt above and below its text as a one-line row. */}
        <View style={styles.firstTallRow}>
          <ListRow title="Prompt" meta={promptPreview(f.prompt, 140)} chevron={false} />
        </View>
        <ListRow title="Runs" trailing={scheduleWords(f.schedule)} chevron={false} />
        <ListRow title="When" trailing={gateWords(f.gate)} chevron={false} />
        <ListRow title="Tools" meta={toolsSummary(f.tools)} chevron={false} />
        <ListRow title="Skills" trailing={skillsSummary(f.skills)} chevron={false} />
        <ListRow
          title="Permission"
          meta={botPermissionNote(f.permission) || undefined}
          metaTone="warn"
          trailing={permissionWords(f.permission)}
          chevron={false}
        />
        <ListRow title="Memory and About you" trailing={f.tools?.useMemory ? "On" : "Off"} chevron={false} />
      </ListGroup>
      <Text style={styles.note}>Say what to change, or create it as it is.</Text>
      <Button label="Create Bot" disabled={busy} loading={busy} onPress={onCreate} />
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  userRow: { alignItems: "flex-end" },
  user: { maxWidth: "85%", backgroundColor: colors.primary, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  userText: { color: colors.primaryForeground, fontSize: 15, lineHeight: 21 },
  answer: { maxWidth: "92%", gap: 4 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  muted: { opacity: 0.7 },
  firstTallRow: { paddingVertical: 6 },
  pending: { borderColor: colors.warning },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrow: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" },
  note: { color: colors.mutedForeground, fontSize: 13 },
  title: { color: colors.foreground, fontSize: 15, fontWeight: "600", lineHeight: 21 },
  body: { color: colors.foreground, fontSize: 15, lineHeight: 21 },
  link: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  linkText: { color: colors.primary, fontSize: 13 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 2 },
  review: { backgroundColor: colors.muted, borderRadius: 12, padding: 12, gap: 8 },
}));
