import type { FreeSlot } from "@timely/contract/schedule";

const SNAP_MINUTES = 15;

function snapUp(date: Date, minutes = SNAP_MINUTES) {
  const step = minutes * 60_000;
  return new Date(Math.ceil(date.getTime() / step) * step);
}

/**
 * The first start, snapped up to a quarter hour, where `durationMinutes` fits
 * inside one of the server's free slots (GET /schedule/free-time). The server
 * owns busy time (ADR 0006); this only picks from the gaps it returned.
 */
export function findNextFreeSlot({
  now = new Date(),
  durationMinutes = 30,
  slots,
}: {
  now?: Date;
  durationMinutes?: number;
  slots: FreeSlot[];
}): Date | null {
  const need = Math.max(SNAP_MINUTES, durationMinutes || 30) * 60_000;
  for (const slot of slots) {
    const end = new Date(slot.end).getTime();
    const start = snapUp(new Date(Math.max(new Date(slot.start).getTime(), now.getTime())));
    if (start.getTime() + need <= end) return start;
  }
  return null;
}
