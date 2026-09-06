import type { CalendarEventEntity, RecurrenceInput } from "../types";
import { api, unwrap } from "./client";

export type CreateEventPayload = {
  title: string;
  description?: string;
  start: string;
  end: string;
  allDay?: boolean;
  color?: string;
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
  recurrence?: RecurrenceInput;
};

export type UpdateEventPayload = {
  title?: string;
  description?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  color?: string;
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
  recurrence?: RecurrenceInput | null;
};

export function getEvents() {
  return api<CalendarEventEntity[]>("/events");
}

export function getEvent(id: string) {
  return api<CalendarEventEntity>(`/events/${encodeURIComponent(id)}`);
}

export async function splitEventSeries(
  id: string,
  data: { fromStart: string; recurrence?: RecurrenceInput; title?: string; start?: string; end?: string },
) {
  const res = await api<CalendarEventEntity | { event: CalendarEventEntity }>(`/events/${id}/recurrence/split`, {
    method: "POST",
    body: data,
  });
  return unwrap(res, "event");
}

export async function createEvent(data: CreateEventPayload) {
  const res = await api<CalendarEventEntity | { event: CalendarEventEntity }>("/events", {
    method: "POST",
    body: data,
  });
  return unwrap(res, "event");
}

export async function updateEvent(id: string, data: UpdateEventPayload) {
  const res = await api<CalendarEventEntity | { event: CalendarEventEntity }>(`/events/${id}`, {
    method: "PUT",
    body: data,
  });
  return unwrap(res, "event");
}

export function deleteEvent(id: string) {
  return api<void>(`/events/${id}`, { method: "DELETE" });
}

export async function editEventOccurrence(
  id: string,
  data: { originalStart: string; action: "skip" | "restore" | "move"; newStart?: string; newEnd?: string },
) {
  const res = await api<CalendarEventEntity | { event: CalendarEventEntity }>(`/events/${id}/occurrences`, {
    method: "PUT",
    body: data,
  });
  return unwrap(res, "event");
}
