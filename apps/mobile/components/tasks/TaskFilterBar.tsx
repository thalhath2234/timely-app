import { ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";
import type { Project, TaskViewConfig, Workspace } from "../../lib/types";
import { createThemedStyleSheet, radius } from "../../lib/theme";
import { Chip, Select } from "../ui/primitives";
import { useSlidingPill } from "../ui/useSlidingPill";

export type TaskFilter = "all" | "today" | "overdue" | "upcoming" | "nodate" | "done" | "reminders" | "board";

export default function TaskFilterBar({
  filter,
  onFilter,
  workspaces,
  workspaceId,
  onWorkspace,
  projects = [],
  projectId,
  onProject,
  counts,
  views = [],
  activeViewId,
  onView,
}: {
  filter: TaskFilter;
  onFilter: (f: TaskFilter) => void;
  workspaces: Workspace[];
  workspaceId: string | null;
  onWorkspace: (id: string | null) => void;
  projects?: Project[];
  projectId?: string | null;
  onProject?: (id: string | null) => void;
  counts: { today: number; overdue: number };
  views?: TaskViewConfig[];
  activeViewId?: string;
  onView?: (id: string) => void;
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
  const chips =
    views.length > 0
      ? [
          ...views.map((view) => ({
            id: view.id,
            label: view.name,
            active: filter !== "board" && view.id === activeViewId,
            onPress: () => onView?.(view.id),
          })),
          {
            id: "board",
            label: "Board",
            active: filter === "board",
            onPress: () => onFilter("board"),
          },
        ]
      : filters.map((item) => ({
          id: item.id,
          label: item.label,
          active: filter === item.id,
          onPress: () => onFilter(item.id),
        }));
  const activeChipId = chips.find((chip) => chip.active)?.id;
  const { onItemLayout, pillStyle } = useSlidingPill(activeChipId);

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.scroller}
      >
        <View style={styles.track}>
          <View style={styles.row}>
            <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]} />
            {chips.map((chip) => (
              <View
                key={chip.id}
                collapsable={false}
                style={styles.chipSlot}
                onLayout={(event) => onItemLayout(chip.id, event)}
              >
                <Chip bare fill label={chip.label} active={chip.active} onPress={chip.onPress} />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      {workspaces.length > 1 || (onProject && projects.length > 0) ? (
        <View style={styles.selects}>
          {workspaces.length > 1 ? (
            <View style={styles.select}>
              <Select
                value={workspaceId ?? ""}
                onChange={(id) => onWorkspace(id || null)}
                placeholder="All spaces"
                options={[
                  { value: "", label: "All spaces" },
                  ...workspaces.map((w) => ({ value: w.id, label: w.name, color: w.color ?? undefined })),
                ]}
              />
            </View>
          ) : null}
          {onProject && projects.length > 0 ? (
            <View style={styles.select}>
              <Select
                value={projectId ?? ""}
                onChange={(id) => onProject(id || null)}
                placeholder="All projects"
                options={[
                  { value: "", label: "All projects" },
                  ...projects.map((project) => ({
                    value: project.id,
                    label: project.title || "Untitled project",
                    color: project.color ?? undefined,
                  })),
                ]}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  wrap: { paddingBottom: 10, gap: 8 },
  scroller: { flexGrow: 1, paddingHorizontal: 12, paddingVertical: 2 },
  track: {
    flexGrow: 1,
    padding: 3,
    borderRadius: radius,
    backgroundColor: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  chipSlot: { flexGrow: 1, flexShrink: 0 },
  pill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: radius - 4,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.ring,
  },
  selects: { paddingHorizontal: 12, flexDirection: "row", gap: 8 },
  select: { flex: 1, minWidth: 0 },
}));
