import { ImageResponse } from "next/og";
import {
  EVENT_BLOCKS,
  EVENT_COLOR,
  PROJECT,
  WEEK_DAYS,
  WORK_BLOCKS,
  WORKING_DAY,
  type CalendarBlock,
} from "@/app/_components/landing/sampleData";

export const alt = "Timely — From loose thoughts to a planned week";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HEADLINE = "From loose thoughts to a planned week.";
const TAGLINE = "A private, open-source planner for desktop and Android.";

/**
 * The landing page's display face, fetched as a TrueType subset holding only
 * `text`. Without network access the image falls back to the default font.
 */
async function loadDisplayFont(weight: 500 | 800, text: string) {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@48,${weight}&text=${encodeURIComponent(text)}`,
    ).then((response) => response.text());
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    const font = url ? await fetch(url) : null;
    if (font?.ok) return await font.arrayBuffer();
  } catch {
    // reported below
  }
  console.warn("opengraph-image: could not load Bricolage Grotesque; using the default font.");
  return null;
}

// The landing hero, redrawn with the flexbox-and-absolute subset ImageResponse supports.
const GRID = { width: 400, height: 330 };

function Block({ block, color }: { block: CalendarBlock; color: string }) {
  const column = GRID.width / WEEK_DAYS.length;
  const row = GRID.height / WORKING_DAY.hours;
  return (
    <div
      style={{
        position: "absolute",
        left: block.day * column + 3,
        top: (block.start - WORKING_DAY.start) * row + 3,
        width: column - 6,
        height: block.hours * row - 6,
        borderRadius: 8,
        borderLeft: `6px solid ${color}`,
        background: `${color}55`,
      }}
    />
  );
}

export default async function Image() {
  const [bold, medium] = await Promise.all([
    loadDisplayFont(800, `${HEADLINE}Timely`),
    loadDisplayFont(500, TAGLINE),
  ]);
  const fonts = bold && medium
    ? [
        { name: "Display", data: bold, weight: 800 as const, style: "normal" as const },
        { name: "Display", data: medium, weight: 500 as const, style: "normal" as const },
      ]
    : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 72px",
          background: "#110f1c",
          color: "#f5f2ff",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 560 }}>
          <div style={{ display: "flex", alignItems: "center", fontFamily: "Display", fontSize: 36, fontWeight: 800 }}>
            <svg width={52} height={52} viewBox="0 0 32 32" style={{ marginRight: 16 }}>
              <rect x={4} y={5.5} width={24} height={5.5} rx={2.75} fill="#f5f2ff" />
              <rect x={4} y={13.25} width={15} height={5.5} rx={2.75} fill="#c0c1ff" />
              <rect x={4} y={21} width={20} height={5.5} rx={2.75} fill="#f5f2ff" />
            </svg>
            Timely
          </div>
          <div
            style={{ marginTop: 36, fontFamily: "Display", fontSize: 70, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2 }}
          >
            {HEADLINE}
          </div>
          <div
            style={{ marginTop: 28, fontFamily: "Display", fontSize: 28, fontWeight: 500, lineHeight: 1.35, color: "#b8b3cc" }}
          >
            {TAGLINE}
          </div>
        </div>

        <div style={{ display: "flex", padding: 34, borderRadius: 56, background: "#b9aee9" }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              width: GRID.width,
              height: GRID.height,
              borderRadius: 20,
              background: "#111319",
              boxShadow: "10px 10px 0 #4a3f86",
            }}
          >
            {EVENT_BLOCKS.map((block) => (
              <Block key={block.title} block={block} color={EVENT_COLOR} />
            ))}
            {WORK_BLOCKS.map((block) => (
              <Block key={`${block.work}-${block.part ?? ""}`} block={block} color={PROJECT.color} />
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
