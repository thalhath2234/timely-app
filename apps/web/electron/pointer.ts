import { screen, type Point } from "electron";

/**
 * Moves the mouse pointer, like Windows' "Snap To" setting: confirm dialogs ask
 * for it so the pointer lands on their default (safe) button.
 *
 * Electron has no API for this, so it calls the OS through koffi (a prebuilt
 * FFI module, no compiler needed): SetCursorPos on Windows and XWarpPointer on
 * Linux under X11. Wayland does not let apps move the pointer at all, and
 * macOS isn't built any more, so there (and anywhere the native call can't be
 * set up) this quietly does nothing.
 */

type Warp = (point: Point) => void;

let warp: Warp | null | undefined;

/** `point` is in screen DIPs, the coordinates Electron's window bounds use. */
export function movePointer(point: Point): void {
  if (warp === undefined) {
    try {
      warp = loadWarp();
    } catch (error) {
      console.warn("[pointer] moving the pointer is unavailable:", error);
      warp = null;
    }
  }
  if (!warp) return;
  try {
    warp(point);
  } catch (error) {
    console.warn("[pointer] move failed:", error);
  }
}

function loadWarp(): Warp | null {
  switch (process.platform) {
    case "win32":
      return loadWindows();
    case "linux":
      return isWayland() ? null : loadX11();
    default:
      return null;
  }
}

function koffi(): typeof import("koffi") {
  // Loaded on first use so a missing or broken native module never stops the
  // app from starting (esbuild keeps it external; electron/build.mjs).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("koffi");
}

function loadWindows(): Warp {
  const user32 = koffi().load("user32.dll");
  const SetCursorPos = user32.func("int __stdcall SetCursorPos(int X, int Y)");
  return (point) => {
    // The main process is per-monitor DPI aware, so SetCursorPos wants
    // physical pixels of the monitor the point is on.
    const { x, y } = screen.dipToScreenPoint(point);
    SetCursorPos(Math.round(x), Math.round(y));
  };
}

function isWayland(): boolean {
  return process.env.XDG_SESSION_TYPE === "wayland" || Boolean(process.env.WAYLAND_DISPLAY);
}

function loadX11(): Warp | null {
  const x11 = koffi().load("libX11.so.6");
  const XOpenDisplay = x11.func("void *XOpenDisplay(const char *name)");
  const XDefaultRootWindow = x11.func("unsigned long XDefaultRootWindow(void *display)");
  const XWarpPointer = x11.func(
    "int XWarpPointer(void *display, unsigned long src, unsigned long dest, int srcX, int srcY, unsigned int srcWidth, unsigned int srcHeight, int destX, int destY)",
  );
  const XFlush = x11.func("int XFlush(void *display)");
  // A connection of our own, kept for the app's lifetime (the OS closes it on exit).
  const display = XOpenDisplay(null);
  if (!display) return null;
  const root = XDefaultRootWindow(display);
  return (point) => {
    const { x, y } = screen.dipToScreenPoint(point);
    XWarpPointer(display, 0, root, 0, 0, 0, 0, Math.round(x), Math.round(y));
    XFlush(display);
  };
}
