import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { pickerFor, reseedPicker } from "../apps/mobile/lib/pickerSeed.ts";

const now = new Date(2026, 11, 7, 9, 7);
const slot = new Date(2026, 11, 8, 13, 30);
const later = new Date(2026, 11, 9, 10, 0);
const base = { open: true, wasOpen: true, now };

// The schedule sheet opens before the server's free-time answer arrives, so the
// suggested slot is a `value` that shows up while the sheet is already open.
describe("reseedPicker", () => {
  test("fills from the value when the sheet opens", () => {
    const seed = reseedPicker({ ...base, wasOpen: false, value: slot, seed: null, current: pickerFor(now) });
    assert.equal(seed?.value, slot.getTime());
    assert.deepEqual(seed?.picker, pickerFor(slot));
  });

  test("adopts a value that arrives while open and untouched", () => {
    const opened = reseedPicker({ ...base, wasOpen: false, value: null, seed: null, current: pickerFor(now) });
    const seed = reseedPicker({ ...base, value: slot, seed: opened, current: opened.picker });
    assert.deepEqual(seed?.picker, pickerFor(slot));
    // and again when a refetch moves the suggestion
    const moved = reseedPicker({ ...base, value: later, seed, current: seed.picker });
    assert.deepEqual(moved?.picker, pickerFor(later));
  });

  test("keeps what the person already picked", () => {
    const opened = reseedPicker({ ...base, wasOpen: false, value: null, seed: null, current: pickerFor(now) });
    const touched = { ...opened.picker, hour: 15 };
    assert.equal(reseedPicker({ ...base, value: slot, seed: opened, current: touched }), null);
  });

  test("leaves the picker alone when nothing changed or the sheet is closed", () => {
    const opened = reseedPicker({ ...base, wasOpen: false, value: slot, seed: null, current: pickerFor(now) });
    assert.equal(reseedPicker({ ...base, value: slot, seed: opened, current: opened.picker }), null);
    assert.equal(reseedPicker({ ...base, open: false, value: later, seed: opened, current: opened.picker }), null);
  });
});
