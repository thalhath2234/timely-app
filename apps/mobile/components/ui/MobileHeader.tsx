import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Bell, ChevronLeft, Settings } from "lucide-react-native";
import { useUnreadNotificationCount } from "../../lib/hooks";
import { colors, createThemedStyleSheet, radius } from "../../lib/theme";
import AnimatedPressable from "./AnimatedPressable";

export function HeaderIconButton({
  label,
  onPress,
  active,
  children,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={[styles.iconBtn, active && { backgroundColor: colors.accent }]}
    >
      {children}
    </AnimatedPressable>
  );
}

function HeaderAccountActions() {
  const router = useRouter();
  const unreadCount = useUnreadNotificationCount().data ?? 0;
  return (
    <>
      <HeaderIconButton label="Notifications" onPress={() => router.push("/(app)/notifications")}>
        <View>
          <Bell size={20} color={colors.foreground} />
          {unreadCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </HeaderIconButton>
      <HeaderIconButton label="Settings" onPress={() => router.push("/(app)/settings")}>
        <Settings size={20} color={colors.foreground} />
      </HeaderIconButton>
    </>
  );
}

export default function MobileHeader({
  title,
  subtitle,
  statusDot,
  large = true,
  back,
  actions,
  accountActions,
  children,
}: {
  title: string;
  subtitle?: string;
  statusDot?: boolean;
  large?: boolean;
  back?: boolean | string;
  actions?: ReactNode;
  accountActions?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const showAccountActions = accountActions ?? !back;
  return (
    <View style={styles.wrap}>
      <View style={[styles.row, !large && styles.rowCompact]}>
        {back ? (
          <AnimatedPressable
            accessibilityRole="button"
            onPress={() => (typeof back === "string" ? router.replace(back as never) : router.back())}
            style={styles.iconBtn}
            accessibilityLabel="Back"
          >
            <ChevronLeft size={22} color={colors.foreground} />
          </AnimatedPressable>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={[styles.title, !large && styles.titleCompact]}>
              {title}
            </Text>
            {statusDot ? <View style={styles.statusDot} /> : null}
          </View>
          {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
        </View>
        <View style={styles.actions}>
          {actions}
          {showAccountActions ? <HeaderAccountActions /> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: {
    paddingBottom: 10,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: {
    minHeight: 74,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowCompact: { minHeight: 56 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  title: { color: colors.foreground, fontSize: 30, fontWeight: "800", letterSpacing: -0.7 },
  titleCompact: { fontSize: 18, fontWeight: "600", letterSpacing: -0.2 },
  sub: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.success,
    shadowColor: colors.success,
    shadowOpacity: 0.8,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 },
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.primaryForeground, fontSize: 9, fontWeight: "700" },
}));
