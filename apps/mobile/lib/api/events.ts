import type { CalendarEventEntity } from "../types";
import type {
  CreateEventPayload,
  EventOccurrencePayload,
  SplitEventSeriesPayload,
  UpdateEventPayload as WireUpdateEventPayload,
} from "@timely/contract/calendar";
import { api, unwrap } from "./client";
import { clearNulls, type Clearable } from "./clearable";

export type {
  CreateEventPayload,
  EventOccurrencePayload,
  SplitEventSeriesPayload,
};

const CLEARABLE_EVENT_FIELDS = ["color", "projectId"] as const;

/** `UpdateEventPayload` from the contract, plus `null` meaning "clear" on `color` and `projectId`. */
export type UpdateEventPayload = Clearable<WireUpdateEventPayload, (typeof CLEARABLE_EVENT_FIELDS)[number]>;

export function getEvents() {
  return api<CalendarEventEntity[]>("/events");
}

export function getEvent(id: string) {
  return api<CalendarEventEntity>(`/events/${encodeURIComponent(id)}`);
}

export async function splitEventSeries(
  id: string,
  data: SplitEventSeriesPayload,
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
    body: clearNulls<WireUpdateEventPayload>(data, CLEARABLE_EVENT_FIELDS),
  });
  return unwrap(res, "event");
}

export function deleteEvent(id: string) {
  return api<void>(`/events/${id}`, { method: "DELETE" });
}

export async function editEventOccurrence(
  id: string,
  data: EventOccurrencePayload,
) {
  const res = await api<CalendarEventEntity | { event: CalendarEventEntity }>(`/events/${id}/occurrences`, {
    method: "PUT",
    body: data,
  });
  return unwrap(res, "event");
}
