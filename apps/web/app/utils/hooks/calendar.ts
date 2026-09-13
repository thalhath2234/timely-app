import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createEvent,
  deleteEvent,
  editEventOccurrence,
  getEvents,
  splitEventSeries,
  updateEvent,
  type EventOccurrencePayload,
  type SplitEventSeriesPayload,
  type UpdateEventPayload,
} from "@/app/utils/api/events";
import {
  addTaskBlock,
  applySchedule,
  clearTaskBlocks,
  deleteBlock,
  getCalendarRange,
  getScheduleSettings,
  getToday,
  getWorkingHours,
  moveBlock,
  pinBlock,
  pinTask,
  previewSchedule,
  undoSchedule,
  updateScheduleSettings,
  updateWorkingHours,
  type AddBlockPayload,
  type PlanRequest,
} from "@/app/utils/api/schedule";
import { tasksKey, todayKey } from "@/app/utils/hooks/tasks";

export const calendarKey = ["calendar"] as const;
export const eventsKey = ["events"] as const;
export const workingHoursKey = ["working-hours"] as const;
export const scheduleSettingsKey = ["schedule-settings"] as const;

/** Range keys are minute-stable so navigating back reuses the cache. */
export function calendarRangeKey(from: Date, to: Date) {
  return [...calendarKey, from.toISOString(), to.toISOString()] as const;
}

export function useCalendarRange(from: Date, to: Date, enabled = true) {
  return useQuery({
    queryKey: calendarRangeKey(from, to),
    queryFn: () => getCalendarRange(from, to),
    enabled,
    staleTime: 30_000,
  });
}

/** Anything that changes calendar time invalidates both the range payload and
 * the task list (scheduledOn / blocks are denormalised onto tasks). */
export function useInvalidateCalendar() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: calendarKey }),
      queryClient.invalidateQueries({ queryKey: tasksKey }),
      queryClient.invalidateQueries({ queryKey: eventsKey }),
      queryClient.invalidateQueries({ queryKey: todayKey }),
      queryClient.invalidateQueries({ queryKey: scheduleSettingsKey }),
    ]);
}

export function useEvents() {
  return useQuery({ queryKey: eventsKey, queryFn: getEvents });
}

export function useCreateEvent() {
  const invalidate = useInvalidateCalendar();
  // A new event changes busy time, but re-planning is left to the explicit
  // Auto-schedule action so the user can review what moves.
  return useMutation({ mutationFn: createEvent, onSuccess: invalidate });
}

export function useUpdateEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateEventPayload & { id: string }) =>
      updateEvent(id, data),
    onSuccess: invalidate,
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: deleteEvent, onSuccess: invalidate });
}

export function useEditEventOccurrence() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, ...data }: EventOccurrencePayload & { id: string }) =>
      editEventOccurrence(id, data),
    onSuccess: invalidate,
  });
}

export function useSplitEventSeries() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, ...data }: SplitEventSeriesPayload & { id: string }) =>
      splitEventSeries(id, data),
    onSuccess: invalidate,
  });
}

export function useWorkingHours() {
  return useQuery({
    queryKey: workingHoursKey,
    queryFn: getWorkingHours,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateWorkingHours() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateWorkingHours,
    onSuccess: (hours) => {
      queryClient.setQueryData(workingHoursKey, hours);
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
  });
}

export function usePreviewSchedule() {
  return useMutation({
    mutationFn: (data: PlanRequest = {}) => previewSchedule(data),
  });
}

export function useApplySchedule() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (data: PlanRequest = {}) => applySchedule(data),
    onSuccess: invalidate,
  });
}

export function useUndoSchedule() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: undoSchedule,
    onSuccess: invalidate,
  });
}

export function useScheduleSettings() {
  return useQuery({ queryKey: scheduleSettingsKey, queryFn: getScheduleSettings });
}

export function useUpdateScheduleSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateScheduleSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(scheduleSettingsKey, settings);
    },
  });
}

export function usePinTask() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ taskId, locked }: { taskId: string; locked: boolean }) => pinTask(taskId, locked),
    onSuccess: invalidate,
  });
}

export function usePinBlock() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ blockId, locked }: { blockId: string; locked: boolean }) => pinBlock(blockId, locked),
    onSuccess: invalidate,
  });
}

export function useAddTaskBlock() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ taskId, ...data }: AddBlockPayload & { taskId: string }) =>
      addTaskBlock(taskId, data),
    onSuccess: invalidate,
  });
}

export function useClearTaskBlocks() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: clearTaskBlocks, onSuccess: invalidate });
}

export function useMoveBlock() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({
      blockId,
      ...data
    }: {
      blockId: string;
      start: string;
      end?: string;
    }) => moveBlock(blockId, data),
    onSuccess: invalidate,
  });
}

export function useDeleteBlock() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: deleteBlock, onSuccess: invalidate });
}

export function useToday(date?: string) {
  return useQuery({
    queryKey: [...todayKey, date ?? ""] as const,
    queryFn: () =>
      getToday(
        date,
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined,
      ),
  });
}
