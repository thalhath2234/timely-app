import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { colors } from "../../lib/theme";

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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.iconBtn, active && { backgroundColor: colors.accent }]}
    >
      {children}
    </Pressable>
  );
}

export default function MobileHeader({
  title,
  subtitle,
  large = true,
  back,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  large?: boolean;
  back?: boolean | string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {back ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => (typeof back === "string" ? router.replace(back as never) : router.back())}
            style={styles.iconBtn}
            accessibilityLabel="Back"
          >
            <ChevronLeft size={22} color={colors.foreground} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.title, !large && styles.titleCompact]}>
            {title}
          </Text>
          {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
        </View>
        <View style={styles.actions}>{actions}</View>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  row: {
    minHeight: 52,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: { color: colors.foreground, fontSize: 22, fontWeight: "600" },
  titleCompact: { fontSize: 17 },
  sub: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
