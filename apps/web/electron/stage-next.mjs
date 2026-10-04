import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
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
//
// Symlinks are deliberately NOT copied verbatim. Node rewrites the relative
// pnpm links inside .next/standalone to absolute paths into .next/standalone,
// and electron-builder dereferences links that point outside the staged tree
// into real files. That is what puts a real apps/web/node_modules/next into
// the package: electron-builder drops the root node_modules/ of every
// extraResources directory (app-builder-lib util/filter.js), so relative links
// into the staged pnpm store would end up dangling.
function copyTree(from, to) {
  cpSync(from, to, { recursive: true, filter: () => true });
}

if (!existsSync(standalone)) {
  throw new Error(
    "Missing .next/standalone. Build with ELECTRON_BUILD=1 first.",
  );
}
if (!existsSync(staticDir)) {
  throw new Error("Missing .next/static. Did next build succeed?");
}

rmSync(staged, { recursive: true, force: true });
copyTree(standalone, staged);

const nestedServer = path.join(staged, "apps", "web", "server.js");
const staticDest = existsSync(nestedServer)
  ? path.join(staged, "apps", "web", ".next", "static")
  : path.join(staged, ".next", "static");
mkdirSync(path.dirname(staticDest), { recursive: true });
copyTree(staticDir, staticDest);

if (existsSync(publicDir)) {
  const publicDest = existsSync(nestedServer)
    ? path.join(staged, "apps", "web", "public")
    : path.join(staged, "public");
  copyTree(publicDir, publicDest);
}

console.log(`staged Next standalone → ${path.relative(webRoot, staged)}`);
