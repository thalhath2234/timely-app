import { useState } from "react";
import { Text, View } from "react-native";
import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react-native";
import type { ChatStep } from "../../lib/chat/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import {
  beforeLabel,
  isRemoval,
  stepIcon,
  stepTarget,
  stepMeta,
  toneColor,
} from "./chatMeta";
import { DetailValue, styles as common } from "./shared";

function Card({
  step,
  index,
  active,
  muted,
  onLink,
}: {
  step: ChatStep;
  index: number;
  active: boolean;
  muted: boolean;
  onLink: (href: string) => void;
}) {
  const removal = isRemoval(step.tool);
  // A pending removal opens with what it removes in view.
  const [open, setOpen] = useState(removal && step.status === "pending");
  const Icon = stepIcon(step.tool);
  const meta = stepMeta(step.status, active);
  const Badge = meta.icon;
  const color = toneColor(meta.tone, colors);
  const link = step.status === "done" ? stepTarget(step) : null;
  return (
    <View
      style={[
        styles.card,
        (step.status === "failed" ||
          (removal && step.status === "pending")) && {
          borderColor: `${colors.destructive}66`,
        },
        muted && { opacity: 0.75 },
      ]}
    >
      <View style={styles.head}>
        <View style={styles.iconWrap}>
          <View
            style={[
              styles.iconTile,
              removal && { backgroundColor: `${colors.destructive}1A` },
            ]}
          >
            <Icon
              size={18}
              color={removal ? colors.destructive : colors.mutedForeground}
            />
          </View>
          <View
            accessibilityLabel={meta.label}
            style={[styles.badge, { backgroundColor: color }]}
          >
            <Badge size={10} color={colors.card} strokeWidth={3} />
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={styles.titleRow}>
            <Text style={styles.number}>{index + 1}</Text>
            <Text
              style={[
                styles.summary,
                step.status === "discarded" && styles.discarded,
              ]}
            >
              {step.summary}
            </Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={[styles.status, { color }]}>{meta.label}</Text>
            {removal ? (
              <View style={styles.removes}>
                <Text style={styles.removesText}>Removes</Text>
              </View>
            ) : null}
          </View>
          {step.status === "failed" && step.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{step.error}</Text>
            </View>
          ) : null}
          {link ? (
            <AnimatedPressable
              accessibilityRole="link"
              accessibilityLabel={`Open ${link.noun}${link.title ? `: ${link.title}` : ""}`}
              onPress={() => onLink(link.href)}
              style={styles.link}
            >
              <Text numberOfLines={1} style={styles.linkText}>
                Open {link.noun}
                {link.title ? (
                  <Text style={styles.linkTitle}> · {link.title}</Text>
                ) : null}
              </Text>
              <ArrowUpRight size={14} color={colors.primary} />
            </AnimatedPressable>
          ) : null}
        </View>
      </View>
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide details" : "Review details"}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.toggle}
      >
        {open ? (
          <ChevronDown size={14} color={colors.mutedForeground} />
        ) : (
          <ChevronRight size={14} color={colors.mutedForeground} />
        )}
        <Text style={common.muted}>Review details</Text>
      </AnimatedPressable>
      {open ? (
        <View style={styles.details}>
          <DetailValue value={step.arguments} onLink={onLink} />
          {step.before ? (
            <View style={styles.before}>
              <Text
                style={[
                  common.fieldLabel,
                  removal && { color: colors.destructive },
                ]}
              >
                {beforeLabel(step.tool)}
              </Text>
              <DetailValue value={step.before} onLink={onLink} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** `activeIndex` marks the step being applied right now. */
export default function ChangeCards({
  steps,
  onLink,
  activeIndex = -1,
  muted = false,
}: {
  steps: ChatStep[];
  onLink: (href: string) => void;
  activeIndex?: number;
  muted?: boolean;
}) {
  return (
    <View style={{ gap: 10 }}>
      {steps.map((step, i) => (
        <Card
          key={i}
          step={step}
          index={i}
          active={i === activeIndex}
          muted={muted}
          onLink={onLink}
        />
      ))}
    </View>
  );
}

const styles = createThemedStyleSheet(() => ({
  card: {
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    alignItems: "flex-start",
  },
  iconWrap: { width: 40, height: 40 },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  number: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 21,
    fontVariant: ["tabular-nums"],
  },
  summary: {
    flex: 1,
    color: colors.foreground,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
  discarded: {
    color: colors.mutedForeground,
    textDecorationLine: "line-through",
  },
  status: { fontSize: 12, fontWeight: "600" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  removes: {
    borderRadius: 999,
    backgroundColor: `${colors.destructive}1A`,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  removesText: { color: colors.destructive, fontSize: 11, fontWeight: "700" },
  errorBox: {
    marginTop: 4,
    borderRadius: 10,
    backgroundColor: `${colors.destructive}14`,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  errorText: { color: colors.destructive, fontSize: 13, lineHeight: 19 },
  link: {
    marginTop: 4,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 10,
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: "100%",
  },
  linkText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 1,
  },
  linkTitle: { fontWeight: "500" },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  details: {
    padding: 14,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  before: {
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
}));
