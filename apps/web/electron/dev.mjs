import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const webRoot = path.join(import.meta.dirname, "..");

await import(pathToFileURL(path.join(import.meta.dirname, "build.mjs")).href);

const children = [];

function spawnInherit(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: webRoot,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const next = spawnInherit("pnpm", ["dev"]);
next.on("exit", (code) => {
  if (children.includes(next)) shutdown(code ?? 0);
});

const electron = spawnInherit(electronBinary, ["."], {
  ELECTRON_DEV: "1",
  ELECTRON_RENDERER_URL: process.env.ELECTRON_RENDERER_URL || "http://127.0.0.1:4001",
});
electron.on("exit", (code) => {
  shutdown(code ?? 0);
});
