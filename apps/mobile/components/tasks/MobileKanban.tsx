import type { ReactElement } from "react";
import { cloneElement } from "react";
import { FlatList, ScrollView, type RefreshControlProps, Text, View } from "react-native";
import type { Task } from "../../lib/types";
import type { NamedStatusGroup } from "../../lib/status";
import { statusNameKey } from "../../lib/status";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import TaskCard from "./TaskCard";

export type KanbanColumn = {
  key: string;
  title: string;
  color: string | null;
  tasks: Task[];
};

export function kanbanColumns(tasks: Task[], statusGroups: NamedStatusGroup[]): KanbanColumn[] {
  const columns: KanbanColumn[] = statusGroups.map((group) => ({
    key: group.key,
    title: group.name,
    color: group.color,
    tasks: [],
  }));
  const none: KanbanColumn = { key: "none", title: "No status", color: null, tasks: [] };
  const byKey = new Map(columns.map((column) => [column.key, column]));

  for (const task of tasks) {
    const key = statusNameKey(task.status?.name) || "none";
    const column = byKey.get(key);
    if (column) column.tasks.push(task);
    else none.tasks.push(task);
  }

  return none.tasks.length > 0 ? [...columns, none] : columns.length > 0 ? columns : [none];
}

export default function MobileKanban({
  columns,
  selectedIds,
  selecting,
  onSelect,
  onToggle,
  onMove,
  refreshControl,
}: {
  columns: KanbanColumn[];
  selectedIds: string[];
  selecting: boolean;
  onSelect: (task: Task) => void;
  onToggle: (task: Task) => void;
  onMove: (task: Task) => void;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      style={styles.scroller}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.board}
    >
      {columns.map((column) => (
        <View key={column.key} style={styles.column}>
          <View style={styles.head}>
            <View style={[styles.dot, { backgroundColor: column.color ?? colors.mutedForeground }]} />
            <Text style={styles.title} numberOfLines={1}>
              {column.title}
            </Text>
            <Text style={styles.count}>{column.tasks.length}</Text>
          </View>
          <FlatList
            data={column.tasks}
            keyExtractor={(item) => item.id}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            contentContainerStyle={styles.cards}
            initialNumToRender={8}
            windowSize={5}
            refreshControl={refreshControl ? cloneElement(refreshControl, { key: column.key }) : undefined}
            ListEmptyComponent={<Text style={styles.empty}>Long-press a card to move it here</Text>}
            renderItem={({ item }) => (
              <View style={styles.cardWrap}>
                <TaskCard
                  task={item}
                  selected={selectedIds.includes(item.id)}
                  selecting={selecting}
                  onSelect={onSelect}
                  onMove={onMove}
                  onToggle={onToggle}
                />
              </View>
            )}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  scroller: { flex: 1 },
  board: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 10,
    flexGrow: 1,
    alignItems: "stretch",
  },
  column: {
    width: 272,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { color: colors.foreground, fontSize: 13, fontWeight: "700", flex: 1 },
  count: { color: colors.mutedForeground, fontSize: 12 },
  list: { flex: 1 },
  cards: { paddingHorizontal: 8, paddingBottom: 110 },
  cardWrap: { marginBottom: 8 },
  empty: { color: colors.mutedForeground, fontSize: 12, paddingHorizontal: 4, paddingVertical: 8 },
}));
