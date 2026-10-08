// Build and package the desktop app.
//
//   node electron/pack.mjs                       # installer(s) for the host OS/arch
//   node electron/pack.mjs --dir                 # unpacked build only
//   node electron/pack.mjs --target darwin-arm64 # one target (also sets TIMELY_TARGETS)
//   node electron/pack.mjs --target darwin-x64,darwin-arm64 --publish always
//
// Without TIMELY_RELEASE=1 (release.yml sets it) the result is "Timely Dev":
// electron-builder.local.yml and a matching main.js (see electron/flavor.ts),
// so a local build runs next to an installed release with its own data.
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
const release = process.env.TIMELY_RELEASE === "1";
const builderConfig = release ? "electron-builder.yml" : "electron-builder.local.yml";
console.log(release ? "release build: Timely" : "local build: Timely Dev (set TIMELY_RELEASE=1 for a release build)");
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

// GitHub Actions passes a missing secret as an empty string, and
// electron-builder reads an empty CSC_LINK / WIN_CSC_LINK as a certificate
// path: it resolves to the working directory and fails with "apps/web not a
// file" (v0.1.2 macOS release job). Unset means unsigned, so drop them.
for (const name of [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
]) {
  if (process.env[name] === "") delete process.env[name];
}

await run("pnpm", [
  "exec",
  "electron-builder",
  "--config",
  builderConfig,
  ...builderFlags,
  ...rest,
]);
