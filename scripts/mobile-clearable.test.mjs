import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { clearNulls } from "../apps/mobile/lib/api/clearable.ts";

// The Go update structs bind pointers: JSON null leaves a column alone, while
// "" (0 for minutes) clears it. clearNulls is what makes a screen's `null`
// reach the server as a clear.
describe("clearNulls", () => {
  test("turns null on listed keys into an empty string", () => {
    assert.deepEqual(
      clearNulls({ deadline: null, name: "Pay rent" }, ["deadline", "projectId"]),
      { deadline: "", name: "Pay rent" },
    );
  });

  test("uses 0 for minute keys", () => {
    assert.deepEqual(
      clearNulls({ preferredChunkMinutes: null }, ["preferredChunkMinutes"], ["preferredChunkMinutes"]),
      { preferredChunkMinutes: 0 },
    );
  });

  test("leaves values, absent keys and unlisted nulls alone", () => {
    const input = { deadline: "2026-10-09", recurrence: null };
    assert.deepEqual(clearNulls(input, ["deadline", "projectId"]), input);
    assert.equal("projectId" in clearNulls(input, ["deadline", "projectId"]), false);
  });

  test("does not mutate its input", () => {
    const input = { stageId: null };
    clearNulls(input, ["stageId"]);
    assert.equal(input.stageId, null);
  });
});
