import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Check, ChevronDown, ChevronUp, Flame, Pencil, Plus, Target, Trash2 } from "lucide-react-native";
import AnimatedPressable from "../ui/AnimatedPressable";
import BottomSheet from "../ui/BottomSheet";
import { SectionLabel } from "../ui/primitives";
import { MAX_FOCUS_NAME, MAX_GOALS, MAX_HABITS, type Goal, type Habit } from "../../lib/api/focus";
import {
  useAddGoal,
  useAddHabit,
  useCheckHabit,
  useDeleteGoal,
  useDeleteHabit,
  useGoalProgressQuery,
  useGoalsQuery,
  useHabitsQuery,
  useRenameGoal,
  useRenameHabit,
  useReorderGoals,
  useReorderHabits,
} from "../../lib/focusHooks";
import { useToastStore } from "../../lib/toast";
import { colors, createThemedStyleSheet } from "../../lib/theme";

const failed = (fallback: string) => (error: unknown) => {
  useToastStore.getState().show(error instanceof Error ? error.message : fallback);
};

function swap(ids: string[], index: number, by: number) {
  const next = [...ids];
  const target = index + by;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function shortDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Habits and goals on the phone's Today: tap a habit to tick it for today
 * (its streak shows beside a flame), and see each goal with the open Work
 * that moves it forward when smart suggestions are on. Editing happens in a
 * bottom sheet. */
export default function HabitsGoalsCard({
  today,
  version,
  onOpenTask,
}: {
  today: string;
  version: string;
  onOpenTask: (id: string) => void;
}) {
  const habits = useHabitsQuery(today);
  const goals = useGoalsQuery();
  const check = useCheckHabit(today);
  const goalList = goals.data ?? [];
  const progress = useGoalProgressQuery(
    `${version}|${goalList.map((goal) => `${goal.id}:${goal.title}`).join(",")}`,
    goalList.length > 0,
  );
  const [editing, setEditing] = useState<null | "habit" | "goal" | "all">(null);
  const [open, setOpen] = useState<string | null>(null);

  if (!habits.data || !goals.data) return null;
  const habitList = habits.data.habits;
  const sheet = (
    <EditSheet
      open={editing !== null}
      focus={editing}
      today={today}
      habits={habitList}
      goals={goalList}
      onClose={() => setEditing(null)}
    />
  );

  if (habitList.length === 0 && goalList.length === 0) {
    return (
      <View style={styles.emptyRow} testID="today-habits-goals">
        <Flame size={14} color={colors.warning} />
        <Text style={styles.meta}>Habits and goals</Text>
        <AnimatedPressable accessibilityRole="button" onPress={() => setEditing("habit")} hitSlop={6}>
          <Text style={styles.link}>Add a habit</Text>
        </AnimatedPressable>
        <AnimatedPressable accessibilityRole="button" onPress={() => setEditing("goal")} hitSlop={6}>
          <Text style={styles.link}>Add a goal</Text>
        </AnimatedPressable>
        {sheet}
      </View>
    );
  }

  const items = new Map((progress.data?.goals ?? []).map((goal) => [goal.goalId, goal.items]));
  return (
    <View style={styles.card} testID="today-habits-goals">
      <View style={styles.header}>
        <Flame size={16} color={colors.warning} />
        <View style={{ flex: 1 }}>
          <SectionLabel
            compact
            action={
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityLabel="Edit habits and goals"
                onPress={() => setEditing("all")}
                hitSlop={8}
                style={styles.editButton}
              >
                <Pencil size={13} color={colors.mutedForeground} />
                <Text style={styles.editText}>Edit</Text>
              </AnimatedPressable>
            }
          >
            Habits and goals
          </SectionLabel>
        </View>
      </View>

      {habitList.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {habitList.map((habit) => (
            <AnimatedPressable
              key={habit.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: habit.doneToday }}
              accessibilityLabel={`${habit.name}, ${habit.streak} day streak`}
              accessibilityHint="Long-press to edit"
              onPress={() => check.mutate({ id: habit.id, done: !habit.doneToday }, { onError: failed("Could not update the habit") })}
              onLongPress={() => setEditing("all")}
              delayLongPress={400}
              style={[styles.chip, habit.doneToday && styles.chipDone]}
            >
              <View style={[styles.checkCircle, habit.doneToday && styles.checkCircleDone]}>
                {habit.doneToday ? <Check size={11} color={colors.success} strokeWidth={3} /> : null}
              </View>
              <Text style={styles.chipText} numberOfLines={1}>{habit.name}</Text>
              <Flame size={12} color={habit.streak > 0 ? colors.warning : colors.mutedForeground} />
              <Text style={[styles.streak, habit.streak > 0 && { color: colors.warning }]}>{habit.streak}</Text>
            </AnimatedPressable>
          ))}
          {habitList.length < MAX_HABITS ? (
            <AnimatedPressable accessibilityRole="button" accessibilityLabel="Add a habit" onPress={() => setEditing("habit")} style={styles.addChip}>
              <Plus size={14} color={colors.mutedForeground} />
            </AnimatedPressable>
          ) : null}
        </ScrollView>
      ) : (
        <View style={styles.inlineRow}>
          <Text style={styles.meta}>No habits yet.</Text>
          <AnimatedPressable accessibilityRole="button" onPress={() => setEditing("habit")} hitSlop={6}>
            <Text style={styles.link}>Add a habit</Text>
          </AnimatedPressable>
        </View>
      )}

      {goalList.length ? (
        goalList.map((goal) => {
          const work = progress.data?.available ? items.get(goal.id) : undefined;
          const expanded = open === goal.id && Boolean(work?.length);
          return (
            <View key={goal.id}>
              <AnimatedPressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                disabled={!work?.length}
                onPress={() => setOpen(expanded ? null : goal.id)}
                onLongPress={() => setEditing("all")}
                style={styles.goalRow}
              >
                <Target size={13} color={colors.primary} />
                <Text style={styles.goalTitle} numberOfLines={1}>{goal.title}</Text>
                {work ? (
                  <View style={styles.countPill}>
                    <Text style={styles.countText}>{work.length} item{work.length === 1 ? "" : "s"}</Text>
                    {work.length ? (expanded ? <ChevronUp size={12} color={colors.mutedForeground} /> : <ChevronDown size={12} color={colors.mutedForeground} />) : null}
                  </View>
                ) : null}
              </AnimatedPressable>
              {expanded && work
                ? work.map((item) => (
                    <AnimatedPressable key={item.taskId} onPress={() => onOpenTask(item.taskId)} style={styles.itemRow}>
                      <Text style={styles.itemText} numberOfLines={1}>{item.name}</Text>
                      {item.deadline ? <Text style={styles.meta}>Due {shortDate(item.deadline)}</Text> : null}
                    </AnimatedPressable>
                  ))
                : null}
            </View>
          );
        })
      ) : (
        <View style={styles.inlineRow}>
          <Text style={styles.meta}>No goals yet.</Text>
          <AnimatedPressable accessibilityRole="button" onPress={() => setEditing("goal")} hitSlop={6}>
            <Text style={styles.link}>Add a goal</Text>
          </AnimatedPressable>
        </View>
      )}
      {progress.data?.error ? <Text style={styles.meta}>{progress.data.error}</Text> : null}
      {sheet}
    </View>
  );
}

function EditSheet({
  open,
  focus,
  today,
  habits,
  goals,
  onClose,
}: {
  open: boolean;
  focus: null | "habit" | "goal" | "all";
  today: string;
  habits: Habit[];
  goals: Goal[];
  onClose: () => void;
}) {
  const addHabit = useAddHabit();
  const renameHabit = useRenameHabit();
  const deleteHabit = useDeleteHabit();
  const reorderHabits = useReorderHabits(today);
  const addGoal = useAddGoal();
  const renameGoal = useRenameGoal();
  const deleteGoal = useDeleteGoal();
  const reorderGoals = useReorderGoals();
  const habitIds = habits.map((habit) => habit.id);
  const goalIds = goals.map((goal) => goal.id);
  return (
    <BottomSheet open={open} onClose={onClose} title="Habits and goals">
      <Text style={styles.sheetLabel}>Habits</Text>
      {habits.map((habit, index) => (
        <EditRow
          key={`${habit.id}:${habit.name}`}
          name={habit.name}
          what="habit"
          first={index === 0}
          last={index === habits.length - 1}
          onMove={(by) => reorderHabits.mutate(swap(habitIds, index, by), { onError: failed("Could not reorder habits") })}
          onRename={(name) => renameHabit.mutate({ id: habit.id, name }, { onError: failed("Could not rename the habit") })}
          onDelete={() => deleteHabit.mutate(habit.id, { onError: failed("Could not delete the habit") })}
          deleteNote="Its streak and check-ins are deleted too."
        />
      ))}
      {habits.length < MAX_HABITS ? (
        <AddRow
          placeholder="Add a habit, like “Walk 20 minutes”"
          autoFocus={focus === "habit"}
          busy={addHabit.isPending}
          onAdd={(name) => addHabit.mutateAsync(name)}
        />
      ) : (
        <Text style={styles.meta}>You have {MAX_HABITS} habits, the most you can keep.</Text>
      )}

      <Text style={[styles.sheetLabel, { marginTop: 18 }]}>Goals (up to {MAX_GOALS})</Text>
      {goals.map((goal, index) => (
        <EditRow
          key={`${goal.id}:${goal.title}`}
          name={goal.title}
          what="goal"
          first={index === 0}
          last={index === goals.length - 1}
          onMove={(by) => reorderGoals.mutate(swap(goalIds, index, by), { onError: failed("Could not reorder goals") })}
          onRename={(title) => renameGoal.mutate({ id: goal.id, title }, { onError: failed("Could not rename the goal") })}
          onDelete={() => deleteGoal.mutate(goal.id, { onError: failed("Could not remove the goal") })}
        />
      ))}
      {goals.length < MAX_GOALS ? (
        <AddRow
          placeholder="Add a goal, like “Run a 10k in spring”"
          autoFocus={focus === "goal"}
          busy={addGoal.isPending}
          onAdd={(title) => addGoal.mutateAsync(title)}
        />
      ) : (
        <Text style={styles.meta}>You have {MAX_GOALS} goals, the most you can keep.</Text>
      )}
    </BottomSheet>
  );
}

/** One editable row: move up or down, rename in place, delete after a
 * second tap that confirms it. */
function EditRow({
  name,
  what,
  first,
  last,
  onMove,
  onRename,
  onDelete,
  deleteNote,
}: {
  name: string;
  what: string;
  first: boolean;
  last: boolean;
  onMove: (by: number) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  deleteNote?: string;
}) {
  const [draft, setDraft] = useState(name);
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <View style={[styles.editRow, styles.confirmRow]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.itemText} numberOfLines={1}>{what === "goal" ? `Remove “${name}”?` : `Delete “${name}”?`}</Text>
          {deleteNote ? <Text style={styles.meta}>{deleteNote}</Text> : null}
        </View>
        <AnimatedPressable accessibilityRole="button" onPress={() => setConfirming(false)} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>Cancel</Text>
        </AnimatedPressable>
        <AnimatedPressable
          accessibilityRole="button"
          onPress={() => {
            setConfirming(false);
            onDelete();
          }}
          style={[styles.smallButton, styles.dangerButton]}
        >
          <Text style={[styles.smallButtonText, { color: "#fff" }]}>{what === "goal" ? "Remove" : "Delete"}</Text>
        </AnimatedPressable>
      </View>
    );
  }
  const save = () => {
    const next = draft.trim();
    if (!next) setDraft(name);
    else if (next !== name) onRename(next);
  };
  return (
    <View style={styles.editRow}>
      <View style={styles.moveButtons}>
        <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Move ${name} up`} disabled={first} onPress={() => onMove(-1)} hitSlop={4} style={first && styles.disabled}>
          <ChevronUp size={16} color={colors.mutedForeground} />
        </AnimatedPressable>
        <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Move ${name} down`} disabled={last} onPress={() => onMove(1)} hitSlop={4} style={last && styles.disabled}>
          <ChevronDown size={16} color={colors.mutedForeground} />
        </AnimatedPressable>
      </View>
      <TextInput
        value={draft}
        onChangeText={(next) => setDraft(next.slice(0, MAX_FOCUS_NAME))}
        onBlur={save}
        onSubmitEditing={save}
        returnKeyType="done"
        accessibilityLabel={`Rename ${what} ${name}`}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        style={styles.input}
      />
      <AnimatedPressable accessibilityRole="button" accessibilityLabel={`Delete ${what} ${name}`} onPress={() => setConfirming(true)} hitSlop={6} style={styles.iconButton}>
        <Trash2 size={16} color={colors.mutedForeground} />
      </AnimatedPressable>
    </View>
  );
}

function AddRow({
  placeholder,
  autoFocus,
  busy,
  onAdd,
}: {
  placeholder: string;
  autoFocus: boolean;
  busy: boolean;
  onAdd: (name: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const name = draft.trim();
    if (!name || busy) return;
    void onAdd(name).then(() => setDraft(""), failed("Could not add it"));
  };
  return (
    <View style={styles.editRow}>
      <TextInput
        value={draft}
        onChangeText={(next) => setDraft(next.slice(0, MAX_FOCUS_NAME))}
        onSubmitEditing={submit}
        autoFocus={autoFocus}
        returnKeyType="done"
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel={placeholder}
        selectionColor={colors.primary}
        style={styles.input}
      />
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel="Add"
        disabled={!draft.trim() || busy}
        onPress={submit}
        style={[styles.addButton, (!draft.trim() || busy) && styles.disabled]}
      >
        <Plus size={16} color={colors.primary} />
      </AnimatedPressable>
    </View>
  );
}

const styles = createThemedStyleSheet((colors) => ({
  card: { gap: 8, marginBottom: 4, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  emptyRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingVertical: 2, marginBottom: 4 },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  meta: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  link: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  editButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 4 },
  editText: { color: colors.mutedForeground, fontSize: 12, fontWeight: "600" },
  chips: { gap: 6, paddingRight: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipDone: { borderColor: colors.success, backgroundColor: colors.accent },
  checkCircle: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.mutedForeground, alignItems: "center", justifyContent: "center" },
  checkCircleDone: { borderColor: colors.success },
  chipText: { color: colors.foreground, fontSize: 13, fontWeight: "600", maxWidth: 150 },
  streak: { color: colors.mutedForeground, fontSize: 11, fontFamily: "SpaceMono", fontVariant: ["tabular-nums"], marginLeft: -3 },
  addChip: { minHeight: 34, width: 34, borderRadius: 17, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  goalRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 },
  goalTitle: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, fontWeight: "600" },
  countPill: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.muted },
  countText: { color: colors.mutedForeground, fontSize: 11, fontWeight: "600" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, marginLeft: 21, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: colors.border },
  itemText: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 13 },
  sheetLabel: { color: colors.mutedForeground, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  confirmRow: { borderColor: colors.destructive },
  moveButtons: { gap: 0 },
  input: { flex: 1, minWidth: 0, color: colors.foreground, fontSize: 14, paddingVertical: 6 },
  iconButton: { padding: 6 },
  addButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  smallButton: { minHeight: 32, paddingHorizontal: 10, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary },
  smallButtonText: { color: colors.foreground, fontSize: 12, fontWeight: "700" },
  dangerButton: { backgroundColor: colors.destructive },
  disabled: { opacity: 0.35 },
}));
