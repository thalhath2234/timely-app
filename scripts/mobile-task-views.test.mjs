import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  adoptDeviceViews,
  capForServer,
  defaultNativeTaskViews,
  NATIVE_VIEW_TEMPLATE,
  normalizeViews,
  rebaseViews,
  sameView,
  withExtra,
} from "../apps/mobile/lib/nativeTaskViewsMerge.ts";

const view = (id, extra = {}) => ({ ...NATIVE_VIEW_TEMPLATE, id, name: id, ...extra });
const ids = (views) => views.map((item) => item.id);

describe("rebaseViews", () => {
  test("adds a view the assistant made after the draft began", () => {
    const base = [view("a"), view("b")];
    const draft = { views: [view("a", { name: "A2" }), view("b")], activeId: "a" };
    const server = [view("a"), view("b"), view("jev")];
    const out = rebaseViews(draft, base, server);
    assert.deepEqual(ids(out.views), ["a", "b", "jev"]);
    assert.equal(out.views[0].name, "A2");
    assert.equal(out.activeId, "a");
  });

  test("takes the server version of a view the draft left alone", () => {
    const base = [view("a"), view("b")];
    const draft = { views: [view("a", { name: "Mine" }), view("b")], activeId: "b" };
    const server = [view("a"), view("b", { sortBy: "priority" })];
    const out = rebaseViews(draft, base, server);
    assert.equal(out.views[0].name, "Mine");
    assert.equal(out.views[1].sortBy, "priority");
  });

  test("drops a view deleted on the server that the draft did not change", () => {
    const base = [view("a"), view("b")];
    const draft = { views: [view("a", { name: "Mine" }), view("b")], activeId: "b" };
    const out = rebaseViews(draft, base, [view("a")]);
    assert.deepEqual(ids(out.views), ["a"]);
    assert.equal(out.activeId, "a");
  });

  test("keeps the draft's own adds, edits and deletes", () => {
    const base = [view("a"), view("b")];
    const draft = { views: [view("b", { name: "Edited" }), view("new")], activeId: "new" };
    const server = [view("a"), view("b")];
    const out = rebaseViews(draft, base, server);
    assert.deepEqual(ids(out.views), ["b", "new"]);
    assert.equal(out.views[0].name, "Edited");
    assert.equal(out.activeId, "new");
  });

  test("a draft with no known base keeps every draft view and adds the server's others", () => {
    const draft = { views: [view("a", { name: "Device" })], activeId: "a" };
    const out = rebaseViews(draft, [], [view("a"), view("jev")]);
    assert.deepEqual(ids(out.views), ["a", "jev"]);
    assert.equal(out.views[0].name, "Device");
  });

  test("key order does not count as a change", () => {
    const base = [view("a")];
    const reordered = Object.fromEntries(Object.entries(view("a")).reverse());
    assert.ok(sameView(base[0], reordered));
    const out = rebaseViews({ views: [reordered], activeId: "a" }, base, [view("a", { name: "Server" })]);
    assert.equal(out.views[0].name, "Server");
  });
});

describe("adoptDeviceViews", () => {
  test("keeps customised built-in views from a device that never synced", () => {
    const seeded = [...defaultNativeTaskViews(), view("jev")];
    const device = defaultNativeTaskViews().map((item) =>
      item.id === "native_view_board" ? { ...item, name: "My board", groupFields: ["priority"] } : item,
    );
    device.push(view("device_only"));
    const out = adoptDeviceViews(seeded, device);
    assert.deepEqual(ids(out), [...ids(seeded), "device_only"]);
    const board = out.find((item) => item.id === "native_view_board");
    assert.equal(board.name, "My board");
    assert.deepEqual(board.groupFields, ["priority"]);
    assert.ok(out.some((item) => item.id === "jev"));
  });

  test("the server's own views win for ids that are not built in", () => {
    const out = adoptDeviceViews([view("x", { name: "Server" })], [view("x", { name: "Device" })]);
    assert.equal(out[0].name, "Server");
  });
});

describe("capForServer", () => {
  const many = Array.from({ length: 23 }, (_, index) => view(`v${index}`));

  test("sends at most 20 and keeps the rest on the device", () => {
    const { sent, extra } = capForServer({ views: many, activeId: "v0" });
    assert.equal(sent.views.length, 20);
    assert.deepEqual(ids(extra), ["v20", "v21", "v22"]);
    assert.equal(sent.activeId, "v0");
  });

  test("keeps the active view inside the cap", () => {
    const { sent, extra } = capForServer({ views: many, activeId: "v22" });
    assert.equal(sent.views.length, 20);
    assert.ok(ids(sent.views).includes("v22"));
    assert.equal(sent.activeId, "v22");
    assert.deepEqual(ids(extra), ["v19", "v20", "v21"]);
  });

  test("a short list is sent whole", () => {
    const { sent, extra } = capForServer({ views: [view("a")], activeId: "missing" });
    assert.deepEqual(ids(sent.views), ["a"]);
    assert.equal(sent.activeId, "a");
    assert.deepEqual(extra, []);
  });

  test("device-only views show after the server's", () => {
    const shown = withExtra({ views: [view("a")], activeId: "a" }, [view("a"), view("z")]);
    assert.deepEqual(ids(shown.views), ["a", "z"]);
  });
});

describe("normalizeViews", () => {
  test("fills missing settings and drops repeated ids", () => {
    const out = normalizeViews([{ id: "a", name: " A " }, { id: "a", name: "again" }, null]);
    assert.deepEqual(ids(out), ["a", "native_view_3"]);
    assert.equal(out[0].name, "A");
    assert.deepEqual(out[0].selectedLabelIds, []);
  });
});
