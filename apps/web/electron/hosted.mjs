// Run the desktop shell in hosted mode (its own Postgres + API + Next sidecars)
// from the checkout, without packaging. Assembles a resources directory from the
// staged sidecars and launches Electron with a throwaway user-data directory.
//
//   make dev-desktop-hosted            (stages, compiles, launches)
//   TIMELY_USER_DATA=/tmp/x node electron/hosted.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const webRoot = path.join(import.meta.dirname, "..");
const os = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
const target = `${os}-${process.arch}`;

const api = path.join(webRoot, ".electron-api", target);
const postgres = path.join(webRoot, ".electron-postgres", target);
const next = path.join(webRoot, ".electron-next");

for (const [name, dir] of [["API", api], ["Postgres", postgres]]) {
  if (!existsSync(dir)) {
    console.error(`${name} is not staged at ${dir}. Run \`make stage-desktop\` first.`);
    process.exit(1);
  }
}
if (!existsSync(next)) {
  console.log("Next.js standalone output missing; building it (ELECTRON_BUILD=1 next build)…");
  await run("pnpm", ["exec", "next", "build"], { ELECTRON_BUILD: "1" });
  await import(pathToFileURL(path.join(import.meta.dirname, "stage-next.mjs")).href);
}

const resources = path.join(webRoot, "tmp", "hosted-resources");
rmSync(resources, { recursive: true, force: true });
mkdirSync(resources, { recursive: true });
symlinkSync(api, path.join(resources, "api"), "dir");
symlinkSync(postgres, path.join(resources, "postgres"), "dir");
symlinkSync(next, path.join(resources, "next-server"), "dir");

const userData = process.env.TIMELY_USER_DATA || path.join(webRoot, "tmp", "hosted-userdata");
mkdirSync(userData, { recursive: true });

console.log(`hosted mode: resources=${resources} userData=${userData}`);
const child = spawn(electronBinary, [".", `--user-data-dir=${userData}`, ...process.argv.slice(2)], {
  cwd: webRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
    TIMELY_HOSTED: "1",
    TIMELY_RESOURCES_DIR: resources,
  },
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: webRoot, stdio: "inherit", env: { ...process.env, ...extraEnv } });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
  });
}
