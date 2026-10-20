import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { backFallback } from "../apps/mobile/lib/backFallback.ts";
import { backPlan } from "../apps/mobile/lib/backPlan.ts";

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

// Every phone screen, reached with no history to pop (a widget, a launcher
// shortcut, a notification): Back goes where it belongs, and only a true root
// leaves the app.
const appDir = new URL("../apps/mobile/app/", import.meta.url);
const screens = readdirSync(appDir, { recursive: true })
  .filter((file) => file.endsWith(".tsx") && !/(^|\/)(_layout|\+html|\+not-found)\.tsx$/.test(file))
  .map((file) => file.replace(/\.tsx$/, ""));

/** The root state for one screen, nested the way expo-router nests groups. */
function stateFor(file) {
  const parts = file.split("/");
  const groups = [];
  while (parts.length && /^\(.+\)$/.test(parts[0])) groups.push(parts.shift());
  let state = { index: 0, routes: [{ name: parts.join("/") }] };
  for (const group of groups.reverse()) state = { index: 0, routes: [{ name: group, state }] };
  return state;
}

function routeExists(href) {
  const path = href.replace(/^\//, "");
  return screens.some((file) => file === path || file === `${path}/index`);
}

describe("backPlan", () => {
  test("covers every screen", () => {
    assert.ok(screens.length > 30, `found ${screens.length} screens`);
    for (const file of screens) {
      const plan = backPlan(stateFor(file), false);
      if (file.startsWith("(app)/(tabs)/") || !file.startsWith("(app)/")) {
        assert.deepEqual(plan, { kind: "leave" }, file);
      } else {
        assert.equal(plan.kind, "up", file);
        assert.ok(routeExists(plan.href), `${file} goes up to ${plan.href}, which is not a screen`);
      }
    }
  });

  test("anything with history pops, so tabs return Home first", () => {
    for (const file of screens) assert.deepEqual(backPlan(stateFor(file), true), { kind: "pop" }, file);
  });

  test("screens go up to where they belong", () => {
    assert.deepEqual(backPlan(stateFor("(app)/sheets/[id]"), false), { kind: "up", href: "/(app)/(tabs)/files" });
    assert.deepEqual(backPlan(stateFor("(app)/today"), false), { kind: "up", href: "/(app)/(tabs)/home" });
    assert.deepEqual(backPlan(stateFor("(app)/settings/index"), false), { kind: "up", href: "/(app)/(tabs)/home" });
    assert.deepEqual(backPlan(stateFor("(app)/settings/agent"), false), { kind: "up", href: "/(app)/settings" });
  });

  test("before the navigators mount the app keeps Back", () => {
    assert.deepEqual(backPlan(undefined, false), { kind: "pop" });
  });

  test("follows every navigation, not just the first render", () => {
    const source = readFileSync(new URL("../apps/mobile/lib/predictiveBack.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /useRootNavigationState/);
    assert.match(source, /addListener\("state"/);
  });
});

// The back preview shows the screen you're going back to, so every pushed
// screen keeps the one underneath drawn and the preview well stays clear.
describe("back preview", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

  test("pushed screens keep the screen underneath drawn", () => {
    const layout = read("../apps/mobile/app/(app)/_layout.tsx");
    assert.match(layout, /\.\.\.predictiveBackScreenOptions\(route\.name === "\(tabs\)"\)/);
    const back = read("../apps/mobile/lib/predictiveBack.tsx");
    assert.match(back, /presentation: "transparentModal"/);
    assert.match(back, /if \(isRoot \|\| !hasTimelyAndroid\(\)\) return null/);
  });

  test("nothing paints over the screen behind the shrinking page", () => {
    const back = read("../apps/mobile/lib/predictiveBack.tsx");
    assert.match(back, /<View style=\{styles\.well\}>/);
    assert.match(back, /well: \{ flex: 1 \}/);
  });
});

// The screen stays put until the finger crosses the back threshold, comes
// back only when the finger returns inside it, and letting go follows the
// same line. It slides away from the edge the swipe started at.
describe("back swipe threshold", () => {
  const native = readFileSync(
    new URL("../apps/mobile/modules/timely-android/android/src/main/java/expo/modules/timelyandroid/TimelyBack.kt", import.meta.url),
    "utf8",
  );

  test("arms at 32dp and only disarms back inside it", () => {
    assert.match(native, /ARM_DP = 32f/);
    assert.match(native, /DISARM_DP = 24f/);
    assert.match(native, /s\.armed = if \(s\.armed\) s\.x >= px\(DISARM_DP\) else s\.x >= px\(ARM_DP\)/);
    // No timers or direction-change rules that can drop the page on a small wobble.
    assert.doesNotMatch(native, /MIN_ARMED_MS|REARM_DP|sinceDisarm|outward/);
  });

  test("letting go does what the screen shows", () => {
    assert.match(native, /if \(s\?\.armed == true\) goBack\(activity, this\)/);
    assert.match(native, /if \(s != null && !s\.armed\) emitter/);
  });

  test("the edge comes from where the swipe started, not only what Android reports", () => {
    assert.match(native, /event\.swipeEdge == BackEventCompat\.EDGE_RIGHT \|\| event\.touchX > screenWidth\(activity\) \/ 2f/);
    assert.match(native, /val fromEdge = if \(s\.right\) s\.startX - event\.touchX else event\.touchX - s\.startX/);
    assert.match(native, /"edge" to if \(swipe\?\.right == true\) "right" else "left"/);
    const back = readFileSync(new URL("../apps/mobile/lib/predictiveBack.tsx", import.meta.url), "utf8");
    assert.match(back, /direction\.value = event\.edge === "right" \? -1 : 1/);
  });

  test("the screen moves on the threshold, not with the finger", () => {
    const back = readFileSync(new URL("../apps/mobile/lib/predictiveBack.tsx", import.meta.url), "utf8");
    assert.match(back, /const target = event\.armed \? 1 : 0;/);
    assert.doesNotMatch(back, /progress\.value = Math\.min\(1, Math\.max\(0, event\.progress\)\)/);
  });
});
