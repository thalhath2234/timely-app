// Renders every empty-state loop (app/_components/film/loops) to an animated
// WebP in apps/mobile/assets/loops/, where the phone's EmptyState plays it.
// `make film-render-loops`. Needs ffmpeg built with libwebp.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const LOOPS = ["capture", "ask", "cards", "project", "files", "schedule"];
const out = resolve("../mobile/assets/loops");
const tmp = resolve("out/loops");
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });
for (const id of LOOPS) {
  const mp4 = `${tmp}/${id}.mp4`;
  execFileSync("pnpm", ["exec", "remotion", "render", `Loop-${id}`, mp4, "--log=error"], { stdio: "inherit" });
  // 15 fps at 420 px keeps each loop under 100 KB; the phone shows it at 320 to 360 px.
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", mp4, "-vf", "fps=15,scale=420:-1", "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "70", "-loop", "0", `${out}/${id}.webp`], { stdio: "inherit" });
  rmSync(mp4);
  console.log(`rendered ${id}.webp`);
}
