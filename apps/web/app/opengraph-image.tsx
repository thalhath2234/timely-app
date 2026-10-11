import { ImageResponse } from "next/og";

export const alt = "Timely: from loose thoughts to a planned week";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HEADLINE = "From loose thoughts to a planned week.";
const TAGLINE = "A private, open-source planner for Windows, Linux and Android.";

/** Blocks on the small week, in the hero's colours: day, start row, rows, colour. */
const BLOCKS = [
  { day: 0, start: 0, rows: 1, color: "#3a3c48" },
  { day: 0, start: 1.3, rows: 2, color: "#c0c1ff" },
  { day: 1, start: 0, rows: 1, color: "#4edea3" },
  { day: 1, start: 2.4, rows: 1.4, color: "#3a3c48" },
  { day: 2, start: 0, rows: 3.6, color: "#f0abfc" },
  { day: 2, start: 4.2, rows: 1.3, color: "#3a3c48" },
  { day: 3, start: 1.4, rows: 1.3, color: "#3a3c48" },
  { day: 3, start: 4.4, rows: 1.3, color: "#7cc4ff" },
  { day: 4, start: 1.3, rows: 3, color: "#3a3c48" },
  { day: 4, start: 5.6, rows: 0.7, color: "#ffb95f" },
];

const COLUMN = 76;
const ROW = 46;

// Drawn with the flexbox-and-absolute subset ImageResponse supports, in the default font.
export default function Image() {
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
          background: "radial-gradient(circle at 20% 0%, #2a2a5c 0%, #0b0c10 55%)",
          color: "#ecebf5",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 560 }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 36, fontWeight: 700 }}>
            <svg width={52} height={52} viewBox="0 0 32 32" style={{ marginRight: 16 }}>
              <rect x={4} y={5.5} width={24} height={5.5} rx={2.75} fill="#ecebf5" />
              <rect x={4} y={13.25} width={15} height={5.5} rx={2.75} fill="#c0c1ff" />
              <rect x={4} y={21} width={20} height={5.5} rx={2.75} fill="#ecebf5" />
            </svg>
            Timely
          </div>
          <div style={{ marginTop: 36, fontSize: 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>{HEADLINE}</div>
          <div style={{ marginTop: 28, fontSize: 28, lineHeight: 1.35, color: "#a4a3b8" }}>{TAGLINE}</div>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            width: COLUMN * 5 + 24,
            height: ROW * 7 + 24,
            borderRadius: 24,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "#111319",
            boxShadow: "0 30px 80px rgba(129,131,244,0.35)",
          }}
        >
          {BLOCKS.map((block, index) => (
            <div
              key={index}
              style={{
                position: "absolute",
                left: 12 + block.day * COLUMN + 3,
                top: 12 + block.start * ROW + 3,
                width: COLUMN - 6,
                height: block.rows * ROW - 6,
                borderRadius: 10,
                borderLeft: `6px solid ${block.color}`,
                background: `${block.color}44`,
              }}
            />
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
