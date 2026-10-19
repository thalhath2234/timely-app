// Renders every help-centre still (app/_components/film/stills.ts) to
// public/help/film/<id>.webp. `make film-render-stills`. Needs ffmpeg with
// libwebp. Run with `node --experimental-strip-types` so the TS table loads.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { STILLS, WINDOW_CROP } from "../app/_components/film/stills.ts";

const out = resolve("public/help/film");
const tmp = resolve("out/stills");
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });
const only = process.argv.slice(2);
for (const [id, still] of Object.entries(STILLS)) {
  if (only.length && !only.includes(id)) continue;
  const png = `${tmp}/${id}.png`;
  execFileSync("pnpm", ["exec", "remotion", "still", still.composition, `--frame=${still.frame}`, "--log=error", "--overwrite", png], { stdio: "inherit" });
  const filters = still.crop === "window" ? [`crop=${WINDOW_CROP.width}:${WINDOW_CROP.height}:${WINDOW_CROP.x}:${WINDOW_CROP.y}`] : [];
  filters.push(`scale=${still.width}:${still.height}`);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", png, "-vf", filters.join(","), "-c:v", "libwebp", "-lossless", "0", "-q:v", "84", `${out}/${id}.webp`], { stdio: "inherit" });
  rmSync(png);
  console.log(`rendered film/${id}.webp`);
}
