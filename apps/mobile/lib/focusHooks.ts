import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addGoal,
  addHabit,
  checkHabit,
  deleteGoal,
  deleteHabit,
  getGoalProgress,
  getGoals,
  getHabits,
  renameGoal,
  renameHabit,
  reorderGoals,
  reorderHabits,
  type Goal,
  type Habit,
} from "./api/focus";
import { useDecisionsStatusQuery } from "./hooks";

export const focusKeys = {
  habits: ["habits"] as const,
  habitsFor: (today: string) => ["habits", today] as const,
  goals: ["goals"] as const,
  goalProgress: ["goal-progress"] as const,
};

type HabitsData = { habits: Habit[]; today: string };

/** Habits with today's check and streak, counted for `today` (YYYY-MM-DD). */
export function useHabitsQuery(today: string) {
  return useQuery({
    queryKey: focusKeys.habitsFor(today),
    queryFn: () => getHabits(today),
    enabled: Boolean(today),
    placeholderData: keepPreviousData,
  });
}

/** Ticks or unticks a habit for today, showing the change right away. */
export function useCheckHabit(today: string) {
  const queryClient = useQueryClient();
  const key = focusKeys.habitsFor(today);
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => checkHabit(id, today, done),
    onMutate: async ({ id, done }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<HabitsData>(key);
      if (previous) {
        queryClient.setQueryData<HabitsData>(key, {
          ...previous,
          habits: previous.habits.map((habit) =>
            habit.id !== id || habit.doneToday === done
              ? habit
              : {
                  ...habit,
                  doneToday: done,
                  streak: Math.max(0, habit.streak + (done ? 1 : -1)),
                  last7: [...habit.last7.slice(0, 6), done],
                },
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: focusKeys.habits }),
  });
}

function useHabitMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: focusKeys.habits }),
  });
}

export const useAddHabit = () => useHabitMutation((name: string) => addHabit(name));
export const useRenameHabit = () =>
  useHabitMutation(({ id, name }: { id: string; name: string }) => renameHabit(id, name));
export const useDeleteHabit = () => useHabitMutation((id: string) => deleteHabit(id));

/** Saves a new habit order, showing it right away. */
export function useReorderHabits(today: string) {
  const queryClient = useQueryClient();
  const key = focusKeys.habitsFor(today);
  return useMutation({
    mutationFn: (ids: string[]) => reorderHabits(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<HabitsData>(key);
      if (previous) {
        const byId = new Map(previous.habits.map((habit) => [habit.id, habit]));
        const habits = ids.map((id) => byId.get(id)).filter((habit): habit is Habit => Boolean(habit));
        queryClient.setQueryData<HabitsData>(key, { ...previous, habits });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: focusKeys.habits }),
  });
}

export function useGoalsQuery() {
  return useQuery({ queryKey: focusKeys.goals, queryFn: getGoals, select: (data) => data.goals });
}

/** Goal edits also change which goal Today's suggestions name. */
function useGoalMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: focusKeys.goals });
      queryClient.invalidateQueries({ queryKey: focusKeys.goalProgress });
      queryClient.invalidateQueries({ queryKey: ["today-suggestions"] });
    },
  });
}

export const useAddGoal = () => useGoalMutation((title: string) => addGoal(title));
export const useRenameGoal = () =>
  useGoalMutation(({ id, title }: { id: string; title: string }) => renameGoal(id, title));
export const useDeleteGoal = () => useGoalMutation((id: string) => deleteGoal(id));

export function useReorderGoals() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => reorderGoals(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: focusKeys.goals });
      const previous = queryClient.getQueryData<{ goals: Goal[] }>(focusKeys.goals);
      if (previous) {
        const byId = new Map(previous.goals.map((goal) => [goal.id, goal]));
        const goals = ids.map((id) => byId.get(id)).filter((goal): goal is Goal => Boolean(goal));
        queryClient.setQueryData(focusKeys.goals, { goals });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(focusKeys.goals, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: focusKeys.goals });
      queryClient.invalidateQueries({ queryKey: focusKeys.goalProgress });
    },
  });
}

/** Open Work that moves each goal forward. Asks nothing while smart
 * suggestions are off; `version` changes when Today's Work changes. */
export function useGoalProgressQuery(version: string, enabled = true) {
  const status = useDecisionsStatusQuery(enabled);
  const on = status.data?.available === true;
  const result = useQuery({
    queryKey: [...focusKeys.goalProgress, version],
    queryFn: getGoalProgress,
    enabled: enabled && on,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return on ? result : { ...result, data: undefined };
}
