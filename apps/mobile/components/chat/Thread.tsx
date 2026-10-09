import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  History,
  Info,
  ReceiptText,
  RefreshCw,
  Sparkles,
  Table2,
  type LucideIcon,
} from "lucide-react-native";
import type { Chat, ChatMessage, ChatStep } from "../../lib/chat/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import ListEnter from "../ui/ListEnter";
import ChangeCards from "./ChangeCards";
import ImagePreview from "./ImagePreview";
import { dayLabel, isBusy, phaseLabel, timeOfDay } from "./chatMeta";
import { Action, ChatText, styles as common } from "./shared";
import { LogoSpinner } from "../ui/TimelyLogo";

const suggestions: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: CalendarDays, title: "Plan my day", text: "Help me plan today." },
  {
    icon: Table2,
    title: "Build a budget",
    text: "Create a project budget sheet with Item, Quantity, Unit price, and Total columns.",
  },
  {
    icon: FolderKanban,
    title: "Make room to learn",
    text: "Create a workspace for learning Japanese and add three study sessions.",
  },
  {
    icon: ReceiptText,
    title: "Save a receipt",
    text: "Attach a receipt photo and I’ll add it to your expense sheet.",
  },
];

export function Welcome({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  return (
    <View style={styles.welcome}>
      <View style={styles.badge}>
        <Sparkles size={14} color={colors.primary} />
        <Text style={styles.badgeText}>Timely assistant</Text>
      </View>
      <Text style={styles.hero}>What would you like to make happen?</Text>
      <Text style={styles.heroText}>
        Plan your day, shape a sheet, or attach a receipt. Small changes happen
        right away; bigger ones wait for your approval.
      </Text>
      <View style={{ gap: 10, marginTop: 6 }}>
        {suggestions.map(({ icon: Icon, title, text }, i) => (
          <ListEnter key={title} index={i}>
            <AnimatedPressable
              accessibilityRole="button"
              accessibilityLabel={title}
              disabled={disabled}
              onPress={() => onPick(text)}
              style={[styles.suggestion, disabled && { opacity: 0.5 }]}
            >
              <View style={styles.suggestionIcon}>
                <Icon size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.suggestionTitle}>{title}</Text>
                <Text numberOfLines={2} style={common.muted}>
                  {text}
                </Text>
              </View>
              <ChevronRight size={16} color={colors.mutedForeground} />
            </AnimatedPressable>
          </ListEnter>
        ))}
      </View>
    </View>
  );
}

function NoticeIcon({ content }: { content: string }) {
  const props = { size: 14, color: colors.mutedForeground };
  if (/^stopped/i.test(content)) return <Ban {...props} />;
  if (/^done/i.test(content) || /confirmed/i.test(content))
    return <CheckCircle2 {...props} color={colors.success} />;
  if (/changed before applying/i.test(content)) return <RefreshCw {...props} />;
  return <Info {...props} />;
}

function Archive({
  message,
  onReview,
}: {
  message: ChatMessage;
  onReview: (steps: ChatStep[]) => void;
}) {
  const steps = message.steps ?? [];
  const done = steps.filter((s) => s.status === "done").length;
  const discarded = message.content.toLowerCase().includes("discard");
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${discarded ? "Discarded" : "Earlier"} proposal, ${steps.length} changes`}
      onPress={() => onReview(steps)}
      style={styles.archive}
    >
      <History size={16} color={colors.mutedForeground} />
      <Text numberOfLines={1} style={[common.muted, { flex: 1 }]}>
        {discarded ? "Discarded proposal" : "Earlier proposal"} · {steps.length}{" "}
        {steps.length === 1 ? "change" : "changes"}
        {done ? `, ${done} applied` : ""}
      </Text>
      <ChevronRight size={16} color={colors.mutedForeground} />
    </AnimatedPressable>
  );
}

export function StatusCard({
  tone,
  icon: Icon,
  title,
  body,
  spinning = false,
  children,
}: {
  tone: "primary" | "destructive" | "success" | "warning";
  icon: LucideIcon;
  title: string;
  body?: string;
  spinning?: boolean;
  children?: React.ReactNode;
}) {
  const color = colors[tone];
  return (
    <View style={[styles.statusCard, { borderColor: `${color}55` }]}>
      <View style={styles.statusRow}>
        <View style={[styles.statusIcon, { backgroundColor: `${color}1f` }]}>
          {spinning ? (
            <LogoSpinner size={18} color={color} />
          ) : (
            <Icon size={18} color={color} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={styles.statusTitle}>{title}</Text>
          {body ? <Text style={common.muted}>{body}</Text> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

export default function Thread({
  chat,
  onLink,
  onPreviewImage,
  onReviewArchive,
  pending,
  onSimilar,
}: {
  chat: Chat;
  onLink: (href: string) => void;
  onPreviewImage: (uri: string) => void;
  onReviewArchive: (steps: ChatStep[]) => void;
  pending: boolean;
  onSimilar: (action: "move" | "stay") => void;
}) {
  let lastDay = "";
  const last = chat.messages[chat.messages.length - 1];
  return (
    <View style={{ gap: 18 }}>
      {chat.messages.map((message) => {
        const day = dayLabel(message.createdAt);
        const separator = day !== lastDay;
        lastDay = day;
        const isUser = message.role === "user" && !message.kind;
        const images = (chat.images ?? []).filter((image) =>
          message.imageIds?.includes(image.id),
        );
        return (
          <View key={message.id} style={{ gap: 18 }}>
            {separator ? (
              <View style={styles.dayRow}>
                <View style={styles.dayLine} />
                <Text style={styles.dayText}>{day}</Text>
                <View style={styles.dayLine} />
              </View>
            ) : null}
            {message.kind === "notice" ? (
              <View style={styles.notice}>
                <NoticeIcon content={message.content} />
                <Text
                  numberOfLines={2}
                  style={[common.muted, { flexShrink: 1 }]}
                >
                  {message.content}
                </Text>
              </View>
            ) : message.kind === "similar" && message.chat ? (
              <View style={styles.similar}>
                <View style={styles.similarRow}>
                  <History size={14} color={colors.mutedForeground} />
                  <Text style={[common.muted, { flexShrink: 1 }]}>
                    You already have a chat about this: {message.chat.title}
                  </Text>
                </View>
                {message === last &&
                !message.choice &&
                chat.status === "choose" ? (
                  <View style={styles.similarRow}>
                    <AnimatedPressable
                      accessibilityRole="button"
                      accessibilityLabel={`Continue in your chat ${message.chat.title}`}
                      disabled={pending}
                      onPress={() => onSimilar("move")}
                      style={[
                        styles.choice,
                        styles.choicePrimary,
                        pending && { opacity: 0.5 },
                      ]}
                    >
                      <Text style={styles.choicePrimaryText}>
                        Continue there
                      </Text>
                    </AnimatedPressable>
                    <AnimatedPressable
                      accessibilityRole="button"
                      disabled={pending}
                      onPress={() => onSimilar("stay")}
                      style={[styles.choice, pending && { opacity: 0.5 }]}
                    >
                      <Text style={styles.choiceText}>Answer here</Text>
                    </AnimatedPressable>
                  </View>
                ) : null}
              </View>
            ) : message.kind === "archive" ? (
              <Archive message={message} onReview={onReviewArchive} />
            ) : isUser ? (
              <View style={styles.userWrap}>
                <View style={styles.userBubble}>
                  <Text selectable style={styles.userText}>
                    {message.content}
                  </Text>
                  {images.length ? (
                    <View style={styles.imageRow}>
                      {images.map((image) => (
                        <ImagePreview
                          key={image.id}
                          image={image}
                          onOpen={onPreviewImage}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
                <Text style={styles.time}>{timeOfDay(message.createdAt)}</Text>
              </View>
            ) : (
              <View style={styles.assistantRow}>
                <View style={styles.avatar}>
                  <Sparkles size={14} color={colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
                  <View style={styles.speakerRow}>
                    <Text style={styles.speaker}>Timely</Text>
                    <Text style={styles.time}>
                      {timeOfDay(message.createdAt)}
                    </Text>
                  </View>
                  <ChatText text={message.content} onLink={onLink} />
                  {images.length ? (
                    <View style={styles.imageRow}>
                      {images.map((image) => (
                        <ImagePreview
                          key={image.id}
                          image={image}
                          onOpen={onPreviewImage}
                        />
                      ))}
                    </View>
                  ) : null}
                  {message.receipt ? <ReceiptCard message={message} /> : null}
                  {message.steps?.length ? (
                    <ChangeCards steps={message.steps} onLink={onLink} />
                  ) : null}
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function ReceiptCard({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const receipt = message.receipt!;
  return (
    <View style={styles.receipt}>
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.receiptHead}
      >
        <ReceiptText size={16} color={colors.primary} />
        <Text numberOfLines={1} style={[styles.suggestionTitle, { flex: 1 }]}>
          {receipt.merchant || "Receipt"} · {receipt.currency} {receipt.total}
        </Text>
        {open ? (
          <ChevronDown size={16} color={colors.mutedForeground} />
        ) : (
          <ChevronRight size={16} color={colors.mutedForeground} />
        )}
      </AnimatedPressable>
      {open ? (
        <View style={{ gap: 4, paddingHorizontal: 12, paddingBottom: 12 }}>
          <Text style={common.muted}>
            {receipt.date || "Date needs review"}
          </Text>
          {receipt.items.map((item, i) => (
            <View key={i} style={styles.receiptItem}>
              <Text style={[common.text, { flex: 1 }]} numberOfLines={1}>
                {item.description || "Unreadable item"}
              </Text>
              <Text style={common.text}>{item.amount || "?"}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function RunStatus({ chat }: { chat: Chat }) {
  if (!isBusy(chat.status) || chat.phase === "apply") return null;
  return (
    <StatusCard
      tone="primary"
      icon={Sparkles}
      spinning
      title={phaseLabel(chat.phase)}
      body="This keeps running on the server. You can close the assistant and come back."
    />
  );
}

export function FailureCard({
  chat,
  locked,
  onRetry,
}: {
  chat: Chat;
  locked: boolean;
  onRetry: () => void;
}) {
  if (!chat.error || chat.plan.length) return null;
  return (
    <StatusCard
      tone="destructive"
      icon={AlertTriangle}
      title="Something went wrong"
      body={chat.error}
    >
      {["failed", "stopped"].includes(chat.status) ? (
        <Action
          label="Try again"
          icon={RefreshCw}
          compact
          disabled={locked}
          onPress={onRetry}
        />
      ) : null}
    </StatusCard>
  );
}

const styles = createThemedStyleSheet(() => ({
  welcome: { gap: 12, paddingTop: 12 },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  hero: {
    color: colors.foreground,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.7,
  },
  heroText: { color: colors.mutedForeground, fontSize: 14, lineHeight: 21 },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  suggestionIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "700",
  },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dayLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dayText: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  notice: {
    alignSelf: "center",
    maxWidth: "92%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  similar: {
    alignSelf: "center",
    maxWidth: "92%",
    alignItems: "center",
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  similarRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  choice: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  choicePrimary: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  choiceText: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
  choicePrimaryText: {
    color: colors.primaryForeground,
    fontSize: 13,
    fontWeight: "600",
  },
  archive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  userWrap: { alignItems: "flex-end", gap: 4, paddingLeft: 40 },
  userBubble: {
    backgroundColor: colors.primary,
    borderRadius: 22,
    borderBottomRightRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 8,
  },
  userText: { color: colors.primaryForeground, fontSize: 15, lineHeight: 22 },
  time: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  assistantRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  speakerRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  speaker: { color: colors.foreground, fontSize: 13, fontWeight: "800" },
  imageRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  receipt: {
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  receiptHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    minHeight: 48,
  },
  receiptItem: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  statusCard: {
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  statusTitle: { color: colors.foreground, fontSize: 15, fontWeight: "700" },
}));
