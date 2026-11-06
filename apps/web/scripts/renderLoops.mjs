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
for (const id of LOOPS) {
  const frames = `${tmp}/${id}`;
  rmSync(frames, { recursive: true, force: true });
  // PNG frames at 2x (1120 px): the phone shows a loop about 350 dp wide, 960 px on a 2.75x screen.
  execFileSync("pnpm", ["exec", "remotion", "render", `Loop-${id}`, frames, "--sequence", "--image-format=png", "--scale=2", "--log=error"], { stdio: "inherit" });
  // Lossless at 15 fps: lossy frames keep near-identical pixels from the frame before, which leaves blocks of stale tint behind every fade.
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "30", "-pattern_type", "glob", "-i", `${frames}/*.png`, "-vf", "fps=15", "-c:v", "libwebp_anim", "-lossless", "1", "-q:v", "100", "-compression_level", "6", "-loop", "0", `${out}/${id}.webp`], { stdio: "inherit" });
  rmSync(frames, { recursive: true });
  console.log(`rendered ${id}.webp`);
}
