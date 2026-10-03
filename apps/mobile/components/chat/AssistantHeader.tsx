import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ArrowLeft, X } from "lucide-react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import TimelyLogo from "../ui/TimelyLogo";
import { IconButton, Pill } from "./shared";
import { statusMeta } from "./chatMeta";

export default function AssistantHeader({
  title,
  subtitle,
  status,
  phase,
  back,
  onBack,
  actions,
}: {
  title: string;
  subtitle: string;
  status?: string;
  phase?: string;
  /** Sub-pages show a back arrow; the root chat shows close. */
  back: boolean;
  onBack: () => void;
  actions?: ReactNode;
}) {
  const meta = status && status !== "idle" ? statusMeta(status) : null;
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
      {!back ? (
        <View style={styles.logo}>
          <TimelyLogo size={18} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <View style={styles.subRow}>
          {meta ? (
            <Pill
              label={
                status === "running" && phase === "apply"
                  ? "Applying"
                  : meta.label
              }
              tone={meta.tone}
              icon={meta.icon}
            />
          ) : null}
          <Text numberOfLines={1} style={[styles.sub, { flexShrink: 1 }]}>
            {subtitle}
          </Text>
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
  subRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  title: {
    color: colors.foreground,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  sub: { color: colors.mutedForeground, fontSize: 12 },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
}));
