import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Screen from "../../components/ui/Screen";
import MobileHeader from "../../components/ui/MobileHeader";
import { useDocsQuery, useProjectsQuery, useSheetsQuery, useTasksQuery, useWorkspacesQuery } from "../../lib/hooks";
import { buildReportData, formatReportDate } from "../../lib/report";
import { sheetHref } from "../../lib/sheet";
import { colors, createThemedStyleSheet } from "../../lib/theme";

function entityPath(kind: string, id: string) {
  if (kind === "task") return `/(app)/tasks/${id}`;
  if (kind === "project") return `/(app)/projects/${id}`;
  if (kind === "doc") return `/(app)/docs/${id}`;
  if (kind === "sheet") return sheetHref(id);
  if (kind === "event") return `/(app)/events/${id}`;
  return null;
}

export default function ReportScreen() {
  const router = useRouter();
  const data = buildReportData({
    tasks: useTasksQuery().data ?? [],
    projects: useProjectsQuery().data ?? [],
    docs: useDocsQuery().data ?? [],
    sheets: useSheetsQuery().data ?? [],
    workspaces: useWorkspacesQuery().data ?? [],
  });

  function open(kind: string, id: string) {
    const href = entityPath(kind, id);
    if (href) router.push(href as never);
  }

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
        <Text style={styles.section}>Priority</Text>
        {data.priorities.length === 0 ? <Text style={styles.hint}>No open work</Text> : null}
        {data.priorities.map((bucket) => (
          <View key={bucket.name} style={styles.rowCol}>
            <View style={styles.row}>
              <Text style={styles.title}>{bucket.name}</Text>
              <Text style={styles.hint}>{bucket.count} · {bucket.percent}%</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${bucket.percent}%` }]} />
            </View>
          </View>
        ))}
        <Text style={styles.section}>Projects with open work</Text>
        {data.byProject.length === 0 ? <Text style={styles.hint}>No project-scoped tasks</Text> : null}
        {data.byProject.map((project) => (
          <Pressable key={project.id} onPress={() => router.push(`/(app)/projects/${project.id}`)} style={styles.row}>
            <Text style={styles.title}>{project.name}</Text>
            <Text style={styles.hint}>{project.count} open</Text>
          </Pressable>
        ))}
        <Text style={styles.section}>By workspace</Text>
        {data.byWorkspace.map((w) => (
          <View key={w.id} style={styles.row}>
            <Text style={styles.title}>{w.name}</Text>
            <Text style={styles.hint}>{w.count} open</Text>
          </View>
        ))}
        <Text style={styles.section}>Mentions</Text>
        {data.mentions.length === 0 ? (
          <Text style={styles.hint}>Type @ in a doc, sheet, task, or project to link things together.</Text>
        ) : (
          data.mentions.map((link, index) => (
            <View key={`${link.from.id}-${link.to.id}-${index}`} style={styles.mention}>
              <Pressable onPress={() => open(link.from.kind, link.from.id)} style={{ flex: 1 }}>
                <Text style={styles.title}>{link.from.label}</Text>
                <Text style={styles.hint}>{link.from.kind}</Text>
              </Pressable>
              <Text style={styles.hint}>→</Text>
              <Pressable onPress={() => open(link.to.entityType, link.to.id)} style={{ flex: 1 }}>
                <Text style={styles.title}>{link.to.label}</Text>
                <Text style={styles.hint}>{link.to.entityType}</Text>
              </Pressable>
            </View>
          ))
        )}
        <Text style={styles.section}>Recent</Text>
        {data.recent.map((item) => (
          <Pressable key={`${item.kind}-${item.id}`} onPress={() => open(item.kind, item.id)} style={styles.row}>
            <Text style={styles.title}>{item.label}</Text>
            <Text style={styles.hint}>{item.kind}</Text>
          </Pressable>
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
  rowCol: { gap: 6 },
  title: { color: colors.foreground, fontSize: 14, fontWeight: "500", flex: 1 },
  barTrack: { height: 6, borderRadius: 999, backgroundColor: colors.muted, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: colors.primary },
  mention: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
}));
