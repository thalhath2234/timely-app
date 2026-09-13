import { CalendarEventEntity, RecurrenceInput } from "@/app/_types/types";
import { apiFetch } from "./client";


async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export interface CreateEventPayload {
  title: string;
  description?: string;
  /** ISO timestamps. */
  start: string;
  end: string;
  allDay?: boolean;
  color?: string;
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
  /** Omit for a one-off event. */
  recurrence?: RecurrenceInput;
}

export interface UpdateEventPayload {
  title?: string;
  description?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  /** Empty string clears the color. */
  color?: string;
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
  /** `null` removes the rule; omit to leave it untouched. */
  recurrence?: RecurrenceInput | null;
}

export type EventOccurrenceAction = "skip" | "restore" | "move";

export interface EventOccurrencePayload {
  originalStart: string;
  action: EventOccurrenceAction;
  newStart?: string;
  newEnd?: string;
}

export interface SplitEventSeriesPayload {
  fromStart: string;
  recurrence: Partial<RecurrenceInput>;
  title?: string;
  start?: string;
  end?: string;
}

export async function getEvents(): Promise<CalendarEventEntity[]> {
  const response = await apiFetch(`/events`, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch events");
  return response.json();
}

export async function createEvent(
  data: CreateEventPayload,
): Promise<CalendarEventEntity> {
  const response = await apiFetch(`/events`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create event"));
  }
  const body = await response.json();
  return body.event ?? body;
}

export async function updateEvent(
  id: string,
  data: UpdateEventPayload,
): Promise<CalendarEventEntity> {
  const response = await apiFetch(`/events/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update event"));
  }
  const body = await response.json();
  return body.event ?? body;
}

export async function deleteEvent(id: string): Promise<void> {
  const response = await apiFetch(`/events/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete event"));
  }
}

export async function editEventOccurrence(
  id: string,
  data: EventOccurrencePayload,
): Promise<CalendarEventEntity> {
  const response = await apiFetch(`/events/${id}/occurrences`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update occurrence"));
  }
  const body = await response.json();
  return body.event ?? body;
}

export async function splitEventSeries(
  id: string,
  data: SplitEventSeriesPayload,
): Promise<CalendarEventEntity> {
  const response = await apiFetch(`/events/${id}/recurrence/split`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to split series"));
  }
  const body = await response.json();
  return body.event ?? body;
}
