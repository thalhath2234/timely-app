// Build and package the desktop app.
//
//   node electron/pack.mjs                       # installer(s) for the host OS/arch
//   node electron/pack.mjs --dir                 # unpacked build only
//   node electron/pack.mjs --target darwin-arm64 # one target (also sets TIMELY_TARGETS)
//   node electron/pack.mjs --target darwin-x64,darwin-arm64 --publish always
//
// Steps: next build (ELECTRON_BUILD=1) → esbuild main/preload → stage Next
// standalone → stage API → stage Postgres → electron-builder. Every other
// argument is passed to electron-builder unchanged. Set TIMELY_SKIP_NEXT=1 to
// reuse an existing .next build while iterating on packaging.

import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { electronBuilderFlags, resolveTargets } from "./targets.mjs";

const webRoot = path.join(import.meta.dirname, "..");

function parseArgs(argv) {
  const rest = [];
  let target = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target") {
      target = argv[++i];
      if (!target) throw new Error("--target needs a value, e.g. --target linux-x64");
    } else if (arg.startsWith("--target=")) {
      target = arg.slice("--target=".length);
    } else {
      rest.push(arg);
    }
  }
  return { target, rest };
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: webRoot,
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

const { target, rest } = parseArgs(process.argv.slice(2));
if (target) process.env.TIMELY_TARGETS = target;
const targets = resolveTargets();
const builderFlags = target ? electronBuilderFlags(targets) : [];
console.log(`packaging for ${targets.map((t) => t.key).join(", ")}`);

if (process.env.TIMELY_SKIP_NEXT === "1") {
  console.log("TIMELY_SKIP_NEXT=1: reusing the existing .next build");
} else {
  await run("pnpm", ["exec", "next", "build"], { ELECTRON_BUILD: "1" });
}

const load = (name) => import(pathToFileURL(path.join(import.meta.dirname, name)).href);
await load("build.mjs");
await load("stage-next.mjs");
const { stageApi } = await load("stage-api.mjs");
stageApi(targets);
const { stagePostgres } = await load("stage-postgres.mjs");
await stagePostgres(targets);

await run("pnpm", [
  "exec",
  "electron-builder",
  "--config",
  "electron-builder.yml",
  ...builderFlags,
  ...rest,
]);
