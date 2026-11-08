// Start at login (apps/web/electron/supervisor/loginItem.ts): every platform's
// path runs here on Linux with a fake Electron login API and an in-memory fs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  HIDDEN_ARG,
  autostartPath,
  desktopEntry,
  escapeString,
  launchTarget,
  quoteExec,
  readLoginItem,
  startedHidden,
  syncLoginItem,
} from "../apps/web/electron/supervisor/loginItem.ts";

const ROOT = path.join(import.meta.dirname, "..");
const APP_ID = "app.timely.desktop.dev";
const WIN_EXE = "C:\\Users\\me\\AppData\\Local\\Programs\\Timely Dev\\timely-dev.exe";

const unquote = (p) => p.trim().replace(/^"+|"+$/g, "").toLowerCase();

/**
 * Electron's Windows login API: Run values named after `name`, StartupApproved
 * as `enabled`. Like Electron, `get` lists only the values whose program is
 * `o.path` ("the executable path to compare against"); `set` writes
 * StartupApproved as enabled unless `enabled: false` (it defaults to true).
 */
function fakeWindows(items = []) {
  const state = { items: items.map((i) => ({ ...i })) };
  const sets = [];
  const gets = [];
  const electron = {
    get(o) {
      gets.push(o);
      const mine = state.items.filter((i) => unquote(i.path) === unquote(o.path));
      return { openAtLogin: mine.length > 0, launchItems: mine.map((i) => ({ ...i, args: [...i.args] })) };
    },
    set(s) {
      sets.push(s);
      state.items = state.items.filter((i) => i.name !== s.name);
      if (s.openAtLogin) state.items.push({ name: s.name, path: s.path, args: s.args ?? [], enabled: s.enabled !== false });
    },
  };
  return { electron, sets, gets, state };
}

function memFs(files = {}) {
  const map = new Map(Object.entries(files));
  const dirs = [];
  return {
    map,
    dirs,
    fs: {
      read: (file) => (map.has(file) ? map.get(file) : null),
      write: (file, text) => map.set(file, text),
      remove: (file) => map.delete(file),
      mkdir: (dir) => dirs.push(dir),
    },
  };
}

function deps(over = {}) {
  const logs = [];
  return {
    logs,
    d: {
      platform: "linux",
      env: {},
      execPath: "/opt/Timely Dev/timely-dev",
      home: "/home/me",
      name: "Timely Dev",
      appId: APP_ID,
      autostartFile: "timely-dev.desktop",
      enabled: true,
      electron: {
        get() {
          throw new Error("no Electron login calls on this platform");
        },
        set() {
          throw new Error("no Electron login calls on this platform");
        },
      },
      log: (m) => logs.push(m),
      ...over,
    },
  };
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function winDeps(win, over = {}) {
  return deps({ platform: "win32", execPath: WIN_EXE, electron: win.electron, ...over }).d;
}

test("windows: a missing entry is added at boot, named after the app id, hidden and enabled", () => {
  const win = fakeWindows();
  const state = syncLoginItem(winDeps(win), true, false);
  assert.deepEqual(win.sets, [{ openAtLogin: true, path: WIN_EXE, args: [HIDDEN_ARG], name: APP_ID, enabled: true }]);
  assert.deepEqual(win.gets[0], { path: WIN_EXE, args: [HIDDEN_ARG] });
  assert.deepEqual(state, { supported: true, on: true, blockedBySystem: false });
});

test("windows: our own entry is left alone at boot", () => {
  const win = fakeWindows([{ name: APP_ID, path: `"${WIN_EXE.toUpperCase()}"`, args: [HIDDEN_ARG], enabled: true }]);
  const state = syncLoginItem(winDeps(win), true, false);
  assert.deepEqual(win.sets, []);
  assert.deepEqual(state, { supported: true, on: true, blockedBySystem: false });
});

test("windows: an entry Startup apps turned off is never re-enabled at boot, and says so", () => {
  const win = fakeWindows([{ name: APP_ID, path: WIN_EXE, args: [HIDDEN_ARG], enabled: false }]);
  const state = syncLoginItem(winDeps(win), true, false);
  assert.deepEqual(win.sets, []);
  assert.equal(state.blockedBySystem, true);
  assert.equal(readLoginItem(winDeps(win)).blockedBySystem, true);
  // Turned off with other arguments: still this exe, so still left alone.
  const noArgs = fakeWindows([{ name: APP_ID, path: WIN_EXE, args: [], enabled: false }]);
  syncLoginItem(winDeps(noArgs), true, false);
  assert.deepEqual(noArgs.sets, []);
});

test("windows: our entry without --hidden is repaired at boot", () => {
  const win = fakeWindows([
    { name: APP_ID, path: WIN_EXE, args: [], enabled: true },
    { name: "app.other", path: "C:\\Other.exe", args: [], enabled: true },
  ]);
  const state = syncLoginItem(winDeps(win), true, false);
  assert.deepEqual(win.sets, [{ openAtLogin: true, path: WIN_EXE, args: [HIDDEN_ARG], name: APP_ID, enabled: true }]);
  assert.equal(state.on, true);
});

test("windows: an entry for another exe is invisible to Electron, so boot writes ours (known limit)", () => {
  // A reinstall into another folder: Electron lists only Run values whose
  // program is this exe, so the old value reads as missing and is replaced,
  // StartupApproved included (docs/desktop/README.md, "Known limit").
  for (const enabled of [true, false]) {
    const win = fakeWindows([{ name: APP_ID, path: "C:\\Old\\timely-dev.exe", args: [HIDDEN_ARG], enabled }]);
    assert.deepEqual(readLoginItem(winDeps(win)), { supported: true, on: false, blockedBySystem: false });
    const state = syncLoginItem(winDeps(win), true, false);
    assert.deepEqual(win.sets, [{ openAtLogin: true, path: WIN_EXE, args: [HIDDEN_ARG], name: APP_ID, enabled: true }]);
    assert.deepEqual(state, { supported: true, on: true, blockedBySystem: false });
  }
});

test("windows: the person's own switch writes even when present or turned off", () => {
  for (const enabled of [true, false]) {
    const win = fakeWindows([{ name: APP_ID, path: WIN_EXE, args: [HIDDEN_ARG], enabled }]);
    const state = syncLoginItem(winDeps(win), true, true);
    assert.deepEqual(win.sets, [{ openAtLogin: true, path: WIN_EXE, args: [HIDDEN_ARG], name: APP_ID, enabled: true }]);
    assert.deepEqual(state, { supported: true, on: true, blockedBySystem: false });
  }
});

test("windows: off removes our entry, and does nothing when there is none", () => {
  const win = fakeWindows([{ name: APP_ID, path: WIN_EXE, args: [HIDDEN_ARG], enabled: true }]);
  const state = syncLoginItem(winDeps(win), false, true);
  assert.deepEqual(win.sets, [{ openAtLogin: false, path: WIN_EXE, args: [HIDDEN_ARG], name: APP_ID }]);
  assert.deepEqual(state, { supported: true, on: false, blockedBySystem: false });
  const none = fakeWindows();
  syncLoginItem(winDeps(none), false, false);
  assert.deepEqual(none.sets, []);
});

test("windows: the path set is always this executable, never one from the environment", () => {
  const win = fakeWindows();
  const env = { APPIMAGE: "C:\\evil.exe", APPDIR: "C:\\Users", TIMELY_EXEC: "C:\\evil.exe" };
  syncLoginItem(winDeps(win, { env }), true, true);
  syncLoginItem(winDeps(win, { env }), true, false, "C:\\evil.exe");
  syncLoginItem(winDeps(win, { env }), false, true);
  assert.ok(win.sets.length >= 2);
  for (const s of win.sets) assert.equal(s.path, WIN_EXE);
  for (const g of win.gets) assert.equal(g.path, WIN_EXE);
});

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------

const AUTOSTART = "/home/me/.config/autostart/timely-dev.desktop";

test("linux: the AppImage path is used only when this process runs from inside it", () => {
  const appimage = { APPIMAGE: "/home/me/Apps/Timely-1.2.0.AppImage", APPDIR: "/tmp/.mount_TimelyX" };
  assert.equal(launchTarget(deps({ env: appimage, execPath: "/tmp/.mount_TimelyX/timely-dev" }).d), appimage.APPIMAGE);
  // Inherited by a child of an AppImage, or a mount that only shares a prefix.
  assert.equal(launchTarget(deps({ env: { APPIMAGE: appimage.APPIMAGE } }).d), "/opt/Timely Dev/timely-dev");
  assert.equal(launchTarget(deps({ env: appimage, execPath: "/tmp/.mount_TimelyXY/timely-dev" }).d), "/tmp/.mount_TimelyXY/timely-dev");
  assert.equal(launchTarget(deps({ env: appimage }).d), "/opt/Timely Dev/timely-dev");
  // Other platforms ignore it.
  assert.equal(launchTarget(deps({ platform: "win32", env: appimage, execPath: WIN_EXE }).d), WIN_EXE);
});

test("linux: an absolute XDG_CONFIG_HOME is honoured, a relative one ignored", () => {
  assert.equal(autostartPath(deps().d), AUTOSTART);
  assert.equal(autostartPath(deps({ env: { XDG_CONFIG_HOME: "/data/conf" } }).d), "/data/conf/autostart/timely-dev.desktop");
  assert.equal(autostartPath(deps({ env: { XDG_CONFIG_HOME: "conf" } }).d), AUTOSTART);
  assert.equal(autostartPath(deps({ autostartFile: "timely.desktop" }).d), "/home/me/.config/autostart/timely.desktop");
});

test("linux: Exec and string values are quoted per the Desktop Entry spec", () => {
  assert.equal(quoteExec("/opt/Timely Dev/timely-dev"), '"/opt/Timely Dev/timely-dev"');
  assert.equal(quoteExec('/a"b'), '"/a\\\\"b"');
  assert.equal(quoteExec("/a$b"), '"/a\\\\$b"');
  assert.equal(quoteExec("/a`b"), '"/a\\\\`b"');
  assert.equal(quoteExec("/a\\b"), '"/a\\\\\\\\b"');
  assert.equal(quoteExec("/a%b"), '"/a%%b"');
  assert.equal(escapeString("/a\\b c"), "/a\\\\b c");
  assert.throws(() => quoteExec("/a\nb"));
  assert.throws(() => escapeString("/a\u007fb"));
});

test("linux: the entry is written exactly, with TryExec and --hidden", () => {
  const mem = memFs();
  const { d } = deps({ fs: mem.fs, execPath: "/opt/Timely Dev/time$ly\\dev" });
  const state = syncLoginItem(d, true, false);
  assert.deepEqual(state, { supported: true, on: true, blockedBySystem: false });
  assert.deepEqual(mem.dirs, ["/home/me/.config/autostart"]);
  assert.equal(
    mem.map.get(AUTOSTART),
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Timely Dev",
      "Comment=Opens Timely Dev in the tray so your bots keep watching",
      "TryExec=/opt/Timely Dev/time$ly\\\\dev",
      'Exec="/opt/Timely Dev/time\\\\$ly\\\\\\\\dev" --hidden',
      "Terminal=false",
      "X-GNOME-Autostart-enabled=true",
      "",
    ].join("\n"),
  );
  assert.equal(desktopEntry("Timely", "/x").endsWith("\n"), true);
});

test("linux: a launch path with a newline is refused, and no file is written", () => {
  const mem = memFs();
  const { d, logs } = deps({ fs: mem.fs, execPath: "/opt/Timely\n[Desktop Entry]/timely" });
  assert.deepEqual(syncLoginItem(d, true, true), { supported: false, on: false, blockedBySystem: false });
  assert.equal(mem.map.size, 0);
  assert.deepEqual(readLoginItem(d), { supported: false, on: false, blockedBySystem: false });
  assert.match(logs[0], /refusing a launch path with a control character/);
  // The same for an AppImage rename target.
  const ok = deps({ fs: mem.fs }).d;
  assert.equal(syncLoginItem(ok, true, false, "/home/me/Timely\r.AppImage").supported, false);
  assert.equal(mem.map.size, 0);
});

test("linux: a stale Exec is rewritten at boot, and a target override writes the new path", () => {
  const stale = desktopEntry("Timely Dev", "/home/me/Timely-1.0.0.AppImage");
  const mem = memFs({ [AUTOSTART]: stale });
  const { d } = deps({ fs: mem.fs });
  syncLoginItem(d, true, false);
  assert.equal(mem.map.get(AUTOSTART), desktopEntry("Timely Dev", "/opt/Timely Dev/timely-dev"));
  // Unchanged: no write.
  let writes = 0;
  const counting = { ...mem.fs, write: (f, t) => (writes++, mem.fs.write(f, t)) };
  syncLoginItem({ ...d, fs: counting }, true, false);
  assert.equal(writes, 0);
  // electron-updater renamed the AppImage on quit.
  syncLoginItem(d, true, false, "/home/me/Timely-1.1.0.AppImage");
  assert.match(mem.map.get(AUTOSTART), /^Exec="\/home\/me\/Timely-1\.1\.0\.AppImage" --hidden$/m);
  assert.match(mem.map.get(AUTOSTART), /^TryExec=\/home\/me\/Timely-1\.1\.0\.AppImage$/m);
});

test("linux: an entry the desktop turned off is kept at boot and reported; the switch rewrites it", () => {
  for (const line of ["Hidden=true", "X-GNOME-Autostart-enabled=false", " Hidden = TRUE "]) {
    const blocked = desktopEntry("Timely Dev", "/old/path").replace("X-GNOME-Autostart-enabled=true\n", `${line}\n`);
    const mem = memFs({ [AUTOSTART]: blocked });
    const { d } = deps({ fs: mem.fs });
    assert.deepEqual(syncLoginItem(d, true, false), { supported: true, on: true, blockedBySystem: true }, line);
    assert.equal(mem.map.get(AUTOSTART), blocked, line);
    assert.deepEqual(syncLoginItem(d, true, true), { supported: true, on: true, blockedBySystem: false }, line);
    assert.equal(mem.map.get(AUTOSTART), desktopEntry("Timely Dev", "/opt/Timely Dev/timely-dev"));
  }
});

test("linux: an AppImage rename re-points a turned-off entry's TryExec and Exec and keeps it off", () => {
  for (const line of ["Hidden=true", "X-GNOME-Autostart-enabled=false"]) {
    const blocked =
      desktopEntry("Timely Dev", "/home/me/Timely-1.0.0.AppImage").replace("X-GNOME-Autostart-enabled=true\n", `${line}\n`) +
      '[Desktop Action New]\nExec="/somewhere/else" --new\n';
    const mem = memFs({ [AUTOSTART]: blocked });
    const { d } = deps({ fs: mem.fs });
    const state = syncLoginItem(d, true, false, "/home/me/Timely 1.1.0.AppImage");
    assert.deepEqual(state, { supported: true, on: true, blockedBySystem: true }, line);
    const text = mem.map.get(AUTOSTART);
    assert.match(text, /^TryExec=\/home\/me\/Timely 1\.1\.0\.AppImage$/m, line);
    assert.match(text, /^Exec="\/home\/me\/Timely 1\.1\.0\.AppImage" --hidden$/m, line);
    assert.ok(text.includes(`\n${line}\n`), line);
    assert.ok(!text.includes("Timely-1.0.0"), line);
    // Other groups are not ours to touch.
    assert.ok(text.endsWith('[Desktop Action New]\nExec="/somewhere/else" --new\n'), line);
    // Already pointing there: no write.
    let writes = 0;
    syncLoginItem({ ...d, fs: { ...mem.fs, write: (f, t) => (writes++, mem.fs.write(f, t)) } }, true, false, "/home/me/Timely 1.1.0.AppImage");
    assert.equal(writes, 0, line);
  }
});

test("linux: off removes the entry", () => {
  const mem = memFs({ [AUTOSTART]: desktopEntry("Timely Dev", "/opt/Timely Dev/timely-dev") });
  const { d } = deps({ fs: mem.fs });
  assert.deepEqual(syncLoginItem(d, false, true), { supported: true, on: false, blockedBySystem: false });
  assert.equal(mem.map.has(AUTOSTART), false);
  assert.deepEqual(readLoginItem(d), { supported: true, on: false, blockedBySystem: false });
});

test("linux: the real file system is used by default", async () => {
  const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
  const os = await import("node:os");
  const dir = mkdtempSync(path.join(os.tmpdir(), "timely-login-item-"));
  try {
    const { d } = deps({ home: dir, execPath: "/opt/timely/timely" });
    delete d.fs;
    syncLoginItem(d, true, false);
    const file = path.join(dir, ".config", "autostart", "timely-dev.desktop");
    assert.equal(readFileSync(file, "utf8"), desktopEntry("Timely Dev", "/opt/timely/timely"));
    syncLoginItem(d, false, true);
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// macOS, unsupported, hidden starts
// ---------------------------------------------------------------------------

test("macOS: only openAtLogin is set", () => {
  const sets = [];
  let open = false;
  let status = "not-registered";
  const electron = { get: () => ({ openAtLogin: open, status }), set: (s) => (sets.push(s), (open = s.openAtLogin)) };
  const d = deps({ platform: "darwin", execPath: "/Applications/Timely.app/Contents/MacOS/Timely", electron }).d;
  assert.deepEqual(syncLoginItem(d, true, false), { supported: true, on: true, blockedBySystem: false });
  assert.deepEqual(sets, [{ openAtLogin: true }]);
  syncLoginItem(d, true, false);
  assert.equal(sets.length, 1);
  status = "requires-approval";
  assert.equal(readLoginItem(d).blockedBySystem, true);
  syncLoginItem(d, false, true);
  assert.deepEqual(sets.at(-1), { openAtLogin: false });
});

test("unsupported: a dev run or another platform makes no calls at all", () => {
  const mem = memFs();
  const throwing = { get: () => assert.fail("get"), set: () => assert.fail("set") };
  const cases = [
    { platform: "win32", enabled: false },
    { platform: "linux", enabled: false },
    { platform: "darwin", enabled: false },
    { platform: "freebsd", enabled: true },
  ];
  for (const c of cases) {
    const d = deps({ ...c, electron: throwing, fs: { ...mem.fs, read: () => assert.fail("read") } }).d;
    assert.deepEqual(readLoginItem(d), { supported: false, on: false, blockedBySystem: false });
    assert.deepEqual(syncLoginItem(d, true, true), { supported: false, on: false, blockedBySystem: false });
    assert.deepEqual(syncLoginItem(d, false, true), { supported: false, on: false, blockedBySystem: false });
  }
  assert.equal(mem.map.size, 0);
});

test("startedHidden: --hidden anywhere, or macOS opening it at login", () => {
  const table = [
    [["timely"], "win32", false, false],
    [["timely", "--hidden"], "win32", false, true],
    [["timely", "--hidden"], "linux", false, true],
    [["timely"], "linux", true, false],
    [["timely"], "darwin", true, true],
    [["timely"], "darwin", false, false],
    [["timely", "--hidden=no"], "win32", false, false],
  ];
  for (const [argv, platform, atLogin, want] of table) assert.equal(startedHidden(argv, platform, atLogin), want, `${argv} ${platform} ${atLogin}`);
});

// ---------------------------------------------------------------------------
// Packaging
// ---------------------------------------------------------------------------

test("the NSIS uninstaller removes the Run value named after the app id, except on update", () => {
  const nsh = readFileSync(path.join(ROOT, "apps/web/electron/nsis/uninstall.nsh"), "utf8");
  assert.match(nsh, /!macro customUnInstall\b/);
  assert.match(nsh, /\$\{ifNot\} \$\{isUpdated\}[\s\S]*\$\{endIf\}/);
  assert.match(nsh, /DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "\$\{APP_ID\}"/);
  assert.match(nsh, /DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" "\$\{APP_ID\}"/);
  const builder = readFileSync(path.join(ROOT, "apps/web/electron-builder.yml"), "utf8");
  const nsis = builder.slice(builder.indexOf("\nnsis:"));
  assert.match(nsis, /^ {2}include: electron\/nsis\/uninstall\.nsh$/m);
  // The local build inherits it and its app id matches the dev flavor's.
  const local = readFileSync(path.join(ROOT, "apps/web/electron-builder.local.yml"), "utf8");
  assert.match(local, /^extends: electron-builder\.yml$/m);
  assert.match(local, new RegExp(`^appId: ${APP_ID.replace(/\./g, "\\.")}$`, "m"));
});
