import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const webRoot = path.join(import.meta.dirname, "..");
const standalone = path.join(webRoot, ".next", "standalone");
const staticDir = path.join(webRoot, ".next", "static");
const publicDir = path.join(webRoot, "public");
const staged = path.join(webRoot, ".electron-next");

if (!existsSync(standalone)) {
  throw new Error("Missing .next/standalone. Build with ELECTRON_BUILD=1 first.");
}
if (!existsSync(staticDir)) {
  throw new Error("Missing .next/static. Did next build succeed?");
}

rmSync(staged, { recursive: true, force: true });
cpSync(standalone, staged, { recursive: true });

const nestedServer = path.join(staged, "apps", "web", "server.js");
const staticDest = existsSync(nestedServer)
  ? path.join(staged, "apps", "web", ".next", "static")
  : path.join(staged, ".next", "static");
mkdirSync(path.dirname(staticDest), { recursive: true });
cpSync(staticDir, staticDest, { recursive: true });

if (existsSync(publicDir)) {
  const publicDest = existsSync(nestedServer)
    ? path.join(staged, "apps", "web", "public")
    : path.join(staged, "public");
  cpSync(publicDir, publicDest, { recursive: true });
}

console.log(`staged Next standalone → ${path.relative(webRoot, staged)}`);
