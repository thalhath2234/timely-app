import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";

const webRoot = path.join(import.meta.dirname, "..");
const standalone = path.join(webRoot, ".next", "standalone");
const staticDir = path.join(webRoot, ".next", "static");
const publicDir = path.join(webRoot, "public");
const staged = path.join(webRoot, ".electron-next");

// Copy a tree. `filter` forces Node's JavaScript copier: the native fast path
// used when no filter is given aborts the whole process on Windows instead of
// throwing (nodejs/node#63970, Node 22.17+), which killed the win32 release job
// with exit 127 and no error message.
function copyTree(from, to, filter = () => true) {
  cpSync(from, to, { recursive: true, dereference: true, filter });
}

// Package directories inside one node_modules folder, scoped ones included.
function listPackages(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .flatMap((name) =>
      name.startsWith("@")
        ? readdirSync(path.join(dir, name)).map((sub) => `${name}/${sub}`)
        : [name],
    );
}

// The standalone output is a pnpm layout: <app>/node_modules/next links into
// the root node_modules/.pnpm store, and each package finds its dependencies as
// siblings in its own .pnpm/<id>/node_modules folder. That layout cannot ship:
// electron-builder drops the root node_modules/ of every extraResources
// directory (app-builder-lib util/filter.js), and links Node rewrote to
// absolute paths keep pointing at the build machine (v0.1.1 shipped a `next`
// link into /home/runner/work/... and failed with "Cannot find module 'next'").
//
// So rebuild <app>/node_modules as a flat tree of real directories: walk the
// dependency graph from the app's own entries, breadth first so the version
// closest to the app wins a name clash, then add pnpm's hoisted packages for
// anything the walk did not reach.
function flattenNodeModules(appModules) {
  const store = path.join(standalone, "node_modules", ".pnpm");
  const queue = listPackages(appModules).map((name) => ({
    name,
    dir: path.join(appModules, name),
  }));
  const hoisted = path.join(store, "node_modules");
  const fallback = listPackages(hoisted).map((name) => ({
    name,
    dir: path.join(hoisted, name),
  }));
  const dest = path.join(staged, path.relative(standalone, appModules));
  const placed = new Set();

  rmSync(dest, { recursive: true, force: true });
  for (const pkg of [queue, fallback]) {
    while (pkg.length > 0) {
      const { name, dir } = pkg.shift();
      if (placed.has(name)) continue;
      placed.add(name);
      const real = realpathSync(dir);
      copyTree(real, path.join(dest, name));
      if (!real.startsWith(store + path.sep)) continue;
      // pnpm puts a package's dependencies next to it: .pnpm/<id>/node_modules.
      const siblings = path.join(real, ...name.split("/").map(() => ".."));
      for (const dep of listPackages(siblings)) {
        if (dep !== name)
          queue.push({ name: dep, dir: path.join(siblings, dep) });
      }
    }
  }
  return placed.size;
}

// Fail the build rather than ship a link that only resolves on this machine.
function assertNoSymlinks(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (lstatSync(full).isSymbolicLink()) {
      throw new Error(`Staged Next tree still contains a symlink: ${full}`);
    }
    if (entry.isDirectory()) assertNoSymlinks(full);
  }
}

if (!existsSync(standalone)) {
  throw new Error(
    "Missing .next/standalone. Build with ELECTRON_BUILD=1 first.",
  );
}
if (!existsSync(staticDir)) {
  throw new Error("Missing .next/static. Did next build succeed?");
}

// Next nests the server under the app's workspace path in a monorepo. Only
// that layout ships: a root node_modules/ would be dropped (see above).
const appRoot = path.join(standalone, "apps", "web");
if (!existsSync(path.join(appRoot, "server.js"))) {
  throw new Error("Expected .next/standalone/apps/web/server.js.");
}
const appModules = path.join(appRoot, "node_modules");
const rootModules = path.join(standalone, "node_modules");
const stagedApp = path.join(staged, "apps", "web");

rmSync(staged, { recursive: true, force: true });
copyTree(
  standalone,
  staged,
  (src) => src !== rootModules && src !== appModules,
);
const packageCount = flattenNodeModules(appModules);

mkdirSync(path.join(stagedApp, ".next"), { recursive: true });
copyTree(staticDir, path.join(stagedApp, ".next", "static"));
if (existsSync(publicDir)) {
  copyTree(publicDir, path.join(stagedApp, "public"));
}

assertNoSymlinks(staged);
console.log(`staged ${packageCount} packages into apps/web/node_modules`);
console.log(`staged Next standalone → ${path.relative(webRoot, staged)}`);
