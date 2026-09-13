import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Screen from "../../components/ui/Screen";
import MobileHeader from "../../components/ui/MobileHeader";
import { useDocsQuery, useProjectsQuery, useSheetsQuery, useTasksQuery, useWorkspacesQuery } from "../../lib/hooks";
import { buildReportData, formatReportDate } from "../../lib/report";
import { colors, createThemedStyleSheet } from "../../lib/theme";

export default function ReportScreen() {
  const router = useRouter();
  const data = buildReportData({
    tasks: useTasksQuery().data ?? [],
    projects: useProjectsQuery().data ?? [],
    docs: useDocsQuery().data ?? [],
    sheets: useSheetsQuery().data ?? [],
    workspaces: useWorkspacesQuery().data ?? [],
  });

  return (
    <Screen>
      <MobileHeader title="Report" back subtitle={`${data.completionRate}% complete`} />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40 }}>
        <View style={styles.grid}>
          {data.stats.map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Text style={styles.statVal}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
              <Text style={styles.hint}>{stat.hint}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.section}>Overdue</Text>
        {data.overdue.length === 0 ? <Text style={styles.hint}>All clear</Text> : null}
        {data.overdue.map((item) => (
          <Pressable key={item.id} onPress={() => router.push(`/(app)/tasks/${item.id}`)} style={styles.row}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={[styles.hint, { color: colors.destructive }]}>{formatReportDate(item.deadline)}</Text>
          </Pressable>
        ))}
        <Text style={styles.section}>Upcoming</Text>
        {data.upcoming.map((item) => (
          <Pressable key={item.id} onPress={() => router.push(`/(app)/tasks/${item.id}`)} style={styles.row}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.hint}>{formatReportDate(item.deadline)}</Text>
          </Pressable>
        ))}
        <Text style={styles.section}>By workspace</Text>
        {data.byWorkspace.map((w) => (
          <View key={w.id} style={styles.row}>
            <Text style={styles.title}>{w.name}</Text>
            <Text style={styles.hint}>{w.count} open</Text>
          </View>
        ))}
        <Text style={styles.section}>Recent</Text>
        {data.recent.map((item) => (
          <View key={`${item.kind}-${item.id}`} style={styles.row}>
            <Text style={styles.title}>{item.label}</Text>
            <Text style={styles.hint}>{item.kind}</Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: {
    width: "48%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  statVal: { color: colors.foreground, fontSize: 24, fontWeight: "700" },
  statLabel: { color: colors.foreground, fontSize: 13, marginTop: 4 },
  hint: { color: colors.mutedForeground, fontSize: 12 },
  section: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginTop: 8 },
  row: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  title: { color: colors.foreground, fontSize: 14, fontWeight: "500", flex: 1 },
}));
