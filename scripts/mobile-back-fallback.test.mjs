import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { backFallback } from "../apps/mobile/lib/backFallback.ts";

// Back on a screen opened with no history (a link, a notification, a reload)
// goes to the tab or list the screen belongs to.
describe("backFallback", () => {
  test("detail screens return to their tab", () => {
    assert.equal(backFallback("/tasks/tsk_1"), "/(app)/(tabs)/tasks");
    assert.equal(backFallback("/events/evt_1"), "/(app)/(tabs)/calendar");
    assert.equal(backFallback("/files/doc_1"), "/(app)/(tabs)/files");
    assert.equal(backFallback("/sheets/templates/shtpl_1"), "/(app)/(tabs)/files");
  });

  test("lists and settings return one level up", () => {
    assert.equal(backFallback("/projects/prj_1"), "/(app)/projects");
    assert.equal(backFallback("/projects"), "/(app)/settings");
    assert.equal(backFallback("/settings/api-keys"), "/(app)/settings");
    assert.equal(backFallback("/settings/workspace/ws_1"), "/(app)/settings/workspaces");
    assert.equal(backFallback("/settings"), "/(app)/(tabs)/home");
  });

  test("reads group-prefixed paths, queries and trailing slashes", () => {
    assert.equal(backFallback("/(app)/events/evt_1/?from=link"), "/(app)/(tabs)/calendar");
  });

  test("anything else goes Home", () => {
    assert.equal(backFallback("/notifications"), "/(app)/(tabs)/home");
    assert.equal(backFallback("/"), "/(app)/(tabs)/home");
  });
});
