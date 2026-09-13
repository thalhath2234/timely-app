import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const webRoot = path.join(import.meta.dirname, "..");
const extraArgs = process.argv.slice(2);

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: webRoot,
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

await run("pnpm", ["exec", "next", "build"], { ELECTRON_BUILD: "1" });
await import(pathToFileURL(path.join(import.meta.dirname, "build.mjs")).href);
await import(pathToFileURL(path.join(import.meta.dirname, "stage-next.mjs")).href);
await run("pnpm", ["exec", "electron-builder", "--config", "electron-builder.yml", ...extraArgs]);
