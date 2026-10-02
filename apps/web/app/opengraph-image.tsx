import { ImageResponse } from "next/og";
import { EVENT_COLOR, EVENT_SLOTS, PROJECT, WORK_SLOTS, type CalendarSlot } from "./_components/landing/sampleData";

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
    if (!url) return null;
    const font = await fetch(url);
    return font.ok ? await font.arrayBuffer() : null;
  } catch {
    return null;
  }
}

// The landing hero, redrawn with the flexbox-and-absolute subset ImageResponse supports.
const GRID = { width: 400, height: 330, days: 5, firstHour: 9, hours: 8 };

function Block({ slot, color }: { slot: CalendarSlot; color: string }) {
  const column = GRID.width / GRID.days;
  const row = GRID.height / GRID.hours;
  return (
    <div
      style={{
        position: "absolute",
        left: slot.day * column + 3,
        top: (slot.start - GRID.firstHour) * row + 3,
        width: column - 6,
        height: slot.hours * row - 6,
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 52,
                height: 52,
                marginRight: 16,
                borderRadius: 14,
                background: "#c0c1ff",
                color: "#1000a9",
              }}
            >
              T
            </div>
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
            {EVENT_SLOTS.map((slot) => (
              <Block key={slot.id} slot={slot} color={EVENT_COLOR} />
            ))}
            {WORK_SLOTS.map((slot) => (
              <Block key={slot.id} slot={slot} color={PROJECT.color} />
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
