import type { ReactElement } from "react";
import { cloneElement, useMemo, useRef } from "react";
import { Animated, FlatList, PanResponder, ScrollView, type RefreshControlProps, Text, View } from "react-native";
import type { Task, TaskListGroupField } from "../../lib/types";
import type { NamedStatusGroup } from "../../lib/status";
import { statusNameKey } from "../../lib/status";
import { PRIORITIES } from "../../lib/priority";
import { GripVertical } from "lucide-react-native";
import { colors, createThemedStyleSheet } from "../../lib/theme";
import TaskCard from "./TaskCard";

export type KanbanColumn = {
  key: string;
  title: string;
  color: string | null;
  tasks: Task[];
};

export function kanbanColumns(tasks: Task[], statusGroups: NamedStatusGroup[], field: TaskListGroupField = "status", selectedStatusIds: string[] = [], selectedPriorityLevels: string[] = []): KanbanColumn[] {
  const selectedStatuses = selectedStatusIds.length ? statusGroups.filter((group) => group.statuses.some((status) => selectedStatusIds.includes(status.id))) : statusGroups;
  const columns: KanbanColumn[] = field === "status" ? selectedStatuses.map((group) => ({
    key: group.key,
    title: group.name,
    color: group.color,
    tasks: [],
  })) : field === "priority" ? (selectedPriorityLevels.length ? PRIORITIES.filter((level) => selectedPriorityLevels.includes(level)) : PRIORITIES).map((level) => ({ key: level, title: level, color: null, tasks: [] })) : [];
  const none: KanbanColumn = { key: "none", title: field === "priority" ? "No priority" : field === "status" ? "No status" : "Other", color: null, tasks: [] };
  if (field !== "status" && field !== "priority") {
    for (const task of tasks) {
      const id = field === "workspace" ? task.workspaceId : field === "project" ? task.projectId : field === "stage" ? task.stageId : null;
      const title = field === "workspace" ? task.workspace?.name : field === "project" ? task.project?.title : field === "stage" ? task.project?.stages?.find((stage) => stage.id === id)?.name : null;
      if (!id) { none.tasks.push(task); continue; }
      let column = columns.find((item) => item.key === id);
      if (!column) { column = { key: id, title: title || "Untitled", color: null, tasks: [] }; columns.push(column); }
      column.tasks.push(task);
    }
    return none.tasks.length ? [...columns, none] : columns;
  }
  const byKey = new Map(columns.map((column) => [column.key, column]));

  for (const task of tasks) {
    const key = field === "priority" ? task.priorityLevel || "none" : statusNameKey(task.status?.name) || "none";
    const column = byKey.get(key);
    if (column) column.tasks.push(task);
    else none.tasks.push(task);
  }

  return none.tasks.length > 0 ? [...columns, none] : columns.length > 0 ? columns : [none];
}

function DraggableCard({ task, columns, targets, onMove, children }: { task: Task; columns: KanbanColumn[]; targets: React.RefObject<Record<string, View | null>>; onMove: (task: Task, column: KanbanColumn) => void; children: React.ReactNode }) {
  const position = useRef(new Animated.ValueXY()).current;
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: Animated.event([null, { dx: position.x, dy: position.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_, gesture) => {
      for (const column of columns) {
        targets.current[column.key]?.measureInWindow((x, y, width, height) => {
          if (gesture.moveX >= x && gesture.moveX <= x + width && gesture.moveY >= y && gesture.moveY <= y + height) onMove(task, column);
        });
      }
      Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
    },
    onPanResponderTerminate: () => Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start(),
  }), [columns, onMove, position, targets, task]);
  return <Animated.View style={[styles.cardWrap, { transform: position.getTranslateTransform(), zIndex: 10 }]}>{children}<View {...pan.panHandlers} accessible accessibilityRole="button" accessibilityLabel={`Drag ${task.name}`} style={styles.dragHandle}><GripVertical size={18} color={colors.mutedForeground} /></View></Animated.View>;
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
  onMove: (task: Task, column: KanbanColumn) => void;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const targets = useRef<Record<string, View | null>>({});
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      style={styles.scroller}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.board}
    >
      {columns.map((column) => (
        <View key={column.key} ref={(node) => { targets.current[column.key] = node; }} style={styles.column}>
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
            ListEmptyComponent={<Text style={styles.empty}>Drag a card here</Text>}
            renderItem={({ item }) => (
              <DraggableCard task={item} columns={columns} targets={targets} onMove={onMove}>
                <TaskCard
                  task={item}
                  selected={selectedIds.includes(item.id)}
                  selecting={selecting}
                  onSelect={onSelect}
                  onToggle={onToggle}
                />
              </DraggableCard>
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
  dragHandle: { position: "absolute", right: 4, bottom: 4, width: 40, height: 38, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.mutedForeground, fontSize: 12, paddingHorizontal: 4, paddingVertical: 8 },
}));
