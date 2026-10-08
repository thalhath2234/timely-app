import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const electronDir = import.meta.dirname;
const webRoot = path.join(electronDir, "..");
const outdir = path.join(webRoot, "dist-electron");

await esbuild.build({
  absWorkingDir: webRoot,
  entryPoints: ["electron/main.ts", "electron/preload.ts", "electron/boot-preload.ts"],
  outdir: "dist-electron",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  // electron-updater stays a runtime dependency (it is in package.json
  // "dependencies", so electron-builder ships it) rather than being bundled.
  external: ["electron", "electron-updater"],
  // electron/flavor.ts: only release.yml sets TIMELY_RELEASE=1; every other
  // build is the side-by-side "Timely Dev".
  define: { __TIMELY_RELEASE__: process.env.TIMELY_RELEASE === "1" ? "true" : "false" },
  logLevel: "info",
});

// The boot screen is a static page loaded by main.ts; electron-builder packs
// everything under dist-electron, so it travels with the compiled output.
mkdirSync(outdir, { recursive: true });
copyFileSync(path.join(electronDir, "boot.html"), path.join(outdir, "boot.html"));
