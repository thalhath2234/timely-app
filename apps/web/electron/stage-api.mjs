// Cross-compile the Go API for each target into .electron-api/<stageDir>/timely-api[.exe].
//
//   node electron/stage-api.mjs                        # host target
//   TIMELY_TARGETS=linux-x64,win32-x64 node electron/stage-api.mjs
//
// The binary is static (CGO_ENABLED=0), trimmed, and stamped with the web
// app's package.json version via -X main.version (a no-op until package main
// declares `var version`).

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTargets } from "./targets.mjs";

const webRoot = path.join(import.meta.dirname, "..");
const apiRoot = path.join(webRoot, "..", "api");
export const stageRoot = path.join(webRoot, ".electron-api");

function appVersion() {
  return JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8")).version;
}

function requireGo() {
  const r = spawnSync("go", ["version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    throw new Error("go was not found on PATH. Install Go 1.25+ (see apps/api/go.mod) to stage the API.");
  }
  return r.stdout.trim();
}

export function stageApi(targets = resolveTargets()) {
  console.log(requireGo());
  const version = appVersion();
  const results = [];
  for (const target of targets) {
    const outDir = path.join(stageRoot, target.stageDir);
    const out = path.join(outDir, `timely-api${target.exe}`);
    mkdirSync(outDir, { recursive: true });
    const args = [
      "build",
      "-trimpath",
      "-ldflags",
      `-s -w -X main.version=${version}`,
      "-o",
      out,
      "./cmd",
    ];
    console.log(`go ${args.join(" ")}  (GOOS=${target.goos} GOARCH=${target.goarch})`);
    const r = spawnSync("go", args, {
      cwd: apiRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOOS: target.goos,
        GOARCH: target.goarch,
        GOFLAGS: process.env.GOFLAGS ?? "-buildvcs=false",
      },
    });
    if (r.status !== 0) {
      throw new Error(`go build for ${target.key} exited ${r.status}`);
    }
    if (!existsSync(out)) {
      throw new Error(`go build for ${target.key} produced no binary at ${out}`);
    }
    if (target.goos !== "windows" && process.platform !== "win32") {
      accessSync(out, constants.X_OK);
    }
    console.log(`staged API ${version} for ${target.key} → ${path.relative(webRoot, out)}`);
    results.push(out);
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageApi();
}
