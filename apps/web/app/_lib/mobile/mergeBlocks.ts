import type { CalendarItem } from "@/app/_types/types";
import { toCalendarEvents } from "@/app/utils/calendar";

/**
 * The API returns one row per 30-minute chunk. `toCalendarEvents` (shared with
 * the desktop calendar) collapses same-task chunks that run back-to-back into a
 * single bar; this maps the result back onto items so every mobile view shows
 * one block per sitting.
 */
export function mergeCalendarItems(items: CalendarItem[]): CalendarItem[] {
  return toCalendarEvents(items).map((event) => ({
    ...event.item,
    id: event.id,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    chunkIndex: 0,
    chunkCount: 1,
  }));
}
