import { useState } from "react";
import { Text, View } from "react-native";
import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react-native";
import type { ChatStep } from "../../lib/chat/types";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import AnimatedPressable from "../ui/AnimatedPressable";
import { stepIcon, stepLinks, stepMeta, toneColor } from "./chatMeta";
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
  const [open, setOpen] = useState(false);
  const Icon = stepIcon(step.tool);
  const meta = stepMeta(step.status, active);
  const Badge = meta.icon;
  const color = toneColor(meta.tone, colors);
  const links = step.status === "done" ? stepLinks(step) : [];
  return (
    <View
      style={[
        styles.card,
        step.status === "failed" && { borderColor: `${colors.destructive}66` },
        muted && { opacity: 0.75 },
      ]}
    >
      <View style={styles.head}>
        <View style={styles.iconWrap}>
          <View style={styles.iconTile}>
            <Icon size={18} color={colors.mutedForeground} />
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
          <Text style={[styles.status, { color }]}>{meta.label}</Text>
          {step.status === "failed" && step.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{step.error}</Text>
            </View>
          ) : null}
          {links.map((link) => (
            <AnimatedPressable
              key={link.href}
              accessibilityRole="link"
              accessibilityLabel={link.label}
              onPress={() => onLink(link.href)}
              style={styles.link}
            >
              <Text numberOfLines={1} style={styles.linkText}>
                {link.label}
              </Text>
              <ArrowUpRight size={14} color={colors.primary} />
            </AnimatedPressable>
          ))}
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
              <Text style={common.fieldLabel}>Existing content</Text>
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
