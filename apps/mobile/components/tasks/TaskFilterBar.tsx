import { ScrollView, StyleSheet, View } from "react-native";
import type { TaskViewConfig, Workspace } from "../../lib/types";
import { Chip, Select } from "../ui/primitives";

export type TaskFilter = "all" | "today" | "overdue" | "upcoming" | "nodate" | "done" | "reminders" | "board";

export default function TaskFilterBar({
  filter,
  onFilter,
  workspaces,
  workspaceId,
  onWorkspace,
  counts,
  views = [],
  activeViewId,
  onView,
  filtersActive,
  onOpenFilters,
}: {
  filter: TaskFilter;
  onFilter: (f: TaskFilter) => void;
  workspaces: Workspace[];
  workspaceId: string | null;
  onWorkspace: (id: string | null) => void;
  counts: { today: number; overdue: number };
  views?: TaskViewConfig[];
  activeViewId?: string;
  onView?: (id: string) => void;
  filtersActive?: boolean;
  onOpenFilters?: () => void;
}) {
  const filters: { id: TaskFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "today", label: counts.today ? `Today ${counts.today}` : "Today" },
    { id: "overdue", label: counts.overdue ? `Overdue ${counts.overdue}` : "Overdue" },
    { id: "upcoming", label: "Upcoming" },
    { id: "nodate", label: "No date" },
    { id: "done", label: "Done" },
    { id: "reminders", label: "Reminders" },
    { id: "board", label: "Board" },
  ];

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {views.length > 0 ? (
          <>
            {views.map((view) => (
              <Chip
                key={view.id}
                label={view.name}
                active={filter !== "board" && view.id === activeViewId}
                onPress={() => onView?.(view.id)}
              />
            ))}
            <Chip label="Board" active={filter === "board"} onPress={() => onFilter("board")} />
          </>
        ) : (
          filters.map((f) => (
            <Chip key={f.id} label={f.label} active={filter === f.id} onPress={() => onFilter(f.id)} />
          ))
        )}
        {onOpenFilters ? (
          <Chip
            label={filtersActive ? "Filters · on" : "Filters"}
            active={Boolean(filtersActive)}
            onPress={onOpenFilters}
          />
        ) : null}
      </ScrollView>
      {workspaces.length > 1 ? (
        <View style={styles.select}>
          <Select
            value={workspaceId ?? ""}
            onChange={(id) => onWorkspace(id || null)}
            placeholder="All spaces"
            options={[
              { value: "", label: "All spaces" },
              ...workspaces.map((w) => ({ value: w.id, label: w.name })),
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 10, gap: 8 },
  row: { paddingHorizontal: 12, gap: 8 },
  select: { paddingHorizontal: 12 },
});
