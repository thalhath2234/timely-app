/** What a date-time picker shows: the month grid, the chosen day and the clock. */
export type PickerState = { month: Date; day: Date; hour: number; minute: number };

/** What the picker was last filled from: the `value` prop and the state it gave. */
export type PickerSeed = { value: number | null; picker: PickerState };

export function snapMinute(raw: number) {
  return (Math.round(raw / 15) * 15) % 60;
}

/**
 * The picker for a time, on the nearest 15-minute step. A step past :45
 * carries into the next hour (and day): 15:59 shows 16:00, never 15:00.
 */
export function pickerFor(date: Date): PickerState {
  const at = new Date(date);
  at.setSeconds(0, 0);
  at.setMinutes(Math.round(at.getMinutes() / 15) * 15);
  return {
    month: new Date(at.getFullYear(), at.getMonth(), 1),
    day: new Date(at.getFullYear(), at.getMonth(), at.getDate()),
    hour: at.getHours(),
    minute: at.getMinutes(),
  };
}

function samePicker(a: PickerState, b: PickerState) {
  return (
    a.month.getTime() === b.month.getTime() &&
    a.day.getTime() === b.day.getTime() &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

/**
 * Whether the picker should be filled from `value` now, and from what. It is
 * filled when the sheet opens, and again when `value` changes while the sheet
 * is open and the person has not touched the picker yet: a suggestion that
 * arrives late (a slow query) is adopted, while a choice the person already
 * made is kept. Returns the new seed, or null to leave the picker alone.
 */
export function reseedPicker({
  open,
  wasOpen,
  value,
  seed,
  current,
  now = new Date(),
}: {
  open: boolean;
  wasOpen: boolean;
  value: Date | null;
  seed: PickerSeed | null;
  current: PickerState;
  now?: Date;
}): PickerSeed | null {
  const valueMs = value ? value.getTime() : null;
  const fresh = (): PickerSeed => ({ value: valueMs, picker: pickerFor(value ?? now) });
  if (open && !wasOpen) return fresh();
  if (!open || !seed || seed.value === valueMs) return null;
  return samePicker(current, seed.picker) ? fresh() : null;
}
