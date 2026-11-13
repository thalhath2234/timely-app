import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ArrowLeft, ChevronDown, X } from "lucide-react-native";
import AnimatedPressable from "../ui/AnimatedPressable";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import TimelyLogo from "../ui/TimelyLogo";
import { IconButton, Pill } from "./shared";
import type { ChatQuestion } from "@timely/contract/agentChat";
import { statusMeta } from "./chatMeta";

export default function AssistantHeader({
  title,
  subtitle,
  status,
  phase,
  question,
  back,
  onBack,
  actions,
  logo = true,
  onTitlePress,
}: {
  title: string;
  subtitle: string;
  status?: string;
  phase?: string;
  /** The card the live run waits on: the pill reads "Needs your answer". */
  question?: ChatQuestion | null;
  /** Sub-pages show a back arrow; the root chat shows close. */
  back: boolean;
  onBack: () => void;
  actions?: ReactNode;
  /** The mark beside the title; off when the permission chip needs the room. */
  logo?: boolean;
  /** Opens the chat menu ("Don't learn from this chat"); the title shows a small chevron. */
  onTitlePress?: () => void;
}) {
  const meta = status && status !== "idle" ? statusMeta(status, question) : null;
  const pillLabel = !meta ? "" : status === "running" && phase === "apply" && meta.tone === "primary" ? "Applying" : meta.label;
  return (
    <View style={styles.wrap}>
      <IconButton
        label={back ? "Back to chat" : "Close assistant"}
        onPress={onBack}
        plain
      >
        {back ? (
          <ArrowLeft size={22} color={colors.foreground} />
        ) : (
          <X size={22} color={colors.foreground} />
        )}
      </IconButton>
      {!back && logo ? (
        <View style={styles.logo}>
          <TimelyLogo size={18} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        {onTitlePress ? (
          <AnimatedPressable
            testID="chat-menu-button"
            accessibilityRole="button"
            accessibilityLabel={`${title}. Chat options`}
            onPress={onTitlePress}
            hitSlop={6}
            style={styles.titleButton}
          >
            <Text numberOfLines={1} style={[styles.title, { flexShrink: 1 }]}>
              {title}
            </Text>
            <ChevronDown size={16} color={colors.mutedForeground} />
          </AnimatedPressable>
        ) : (
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        )}
        <View style={styles.subRow}>
          {meta ? (
            // A short status keeps its whole word and the model line gives
            // way; a long one (shown alone) ends with "…" when room is short.
            <View style={{ flexShrink: pillLabel.length <= 12 ? 0 : 1, minWidth: 0 }}>
              <Pill
                label={pillLabel}
                tone={meta.tone}
                icon={meta.icon}
                spin={meta.spin}
              />
            </View>
          ) : null}
          {/* A long status ("Choose where to continue") leaves no room for
              the model line, which would clip to a letter or two. */}
          {pillLabel.length <= 12 ? (
            <Text numberOfLines={1} style={[styles.sub, { flexShrink: 1 }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>{actions}</View>
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  wrap: {
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  titleButton: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", maxWidth: "100%" },
  subRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  title: {
    color: colors.foreground,
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  sub: { color: colors.mutedForeground, fontSize: 12 },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
}));
