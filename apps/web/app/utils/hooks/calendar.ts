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
  getWorkingHours,
  moveBlock,
  previewSchedule,
  updateWorkingHours,
  type AddBlockPayload,
  type PlanRequest,
} from "@/app/utils/api/schedule";
import { tasksKey } from "@/app/utils/hooks/tasks";

export const calendarKey = ["calendar"] as const;
export const eventsKey = ["events"] as const;
export const workingHoursKey = ["working-hours"] as const;

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
    ]);
}

export function useEvents() {
  return useQuery({ queryKey: eventsKey, queryFn: getEvents });
}

export function useCreateEvent() {
  const invalidate = useInvalidateCalendar();
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
