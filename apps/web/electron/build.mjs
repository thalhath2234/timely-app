import * as esbuild from "esbuild";
import path from "node:path";

const electronDir = import.meta.dirname;
const webRoot = path.join(electronDir, "..");

await esbuild.build({
  absWorkingDir: webRoot,
  entryPoints: ["electron/main.ts", "electron/preload.ts"],
  outdir: "dist-electron",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  external: ["electron"],
  logLevel: "info",
});
