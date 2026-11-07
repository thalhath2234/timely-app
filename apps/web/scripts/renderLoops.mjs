// Renders every empty-state loop (app/_components/film/loops) to an animated
// WebP in apps/mobile/assets/loops/, where the phone's EmptyState plays it.
// `make film-render-loops`, or `make film-render-loops ONLY=<id>` (`--only <id>`)
// to render one loop and leave the other WebPs untouched. Needs ffmpeg built
// with libwebp.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const LOOPS = ["capture", "ask", "cards", "project", "files", "schedule", "bots"];
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const flag = args.findIndex((arg) => arg === "--only" || arg.startsWith("--only="));
const only = flag < 0 ? null : args[flag].startsWith("--only=") ? args[flag].slice("--only=".length) : args[flag + 1];
if (flag >= 0 && !LOOPS.includes(only)) {
  console.error(`--only needs one of: ${LOOPS.join(", ")}`);
  process.exit(1);
}
const out = resolve("../mobile/assets/loops");
const tmp = resolve("out/loops");
mkdirSync(out, { recursive: true });
for (const id of only ? [only] : LOOPS) {
  const frames = `${tmp}/${id}`;
  rmSync(frames, { recursive: true, force: true });
  // PNG frames at 2x (1120 px): the phone shows a loop about 350 dp wide, 960 px on a 2.75x screen.
  execFileSync("pnpm", ["exec", "remotion", "render", `Loop-${id}`, frames, "--sequence", "--image-format=png", "--scale=2", "--log=error"], { stdio: "inherit" });
  // Lossless at 15 fps: lossy frames keep near-identical pixels from the frame before, which leaves blocks of stale tint behind every fade.
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", "30", "-pattern_type", "glob", "-i", `${frames}/*.png`, "-vf", "fps=15", "-c:v", "libwebp_anim", "-lossless", "1", "-q:v", "100", "-compression_level", "6", "-loop", "0", `${out}/${id}.webp`], { stdio: "inherit" });
  rmSync(frames, { recursive: true });
  console.log(`rendered ${id}.webp`);
}
