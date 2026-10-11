import type { ComponentType } from "react";

/* Six small, flat drawings for the feature cards, one per feature in the
   order of FEATURES: calendar, docs and sheets, search, dashboard, habits,
   views. Each is drawn in the feature's colour on a 200x56 canvas. */

type GlyphProps = { color: string };

const line = "rgb(236 235 245 / 14%)";
const soft = "rgb(236 235 245 / 38%)";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 200 56" className="block h-14 w-full" aria-hidden>
      {children}
    </svg>
  );
}

/** A week strip where a work block sits in free time between two meetings. */
function CalendarGlyph({ color }: GlyphProps) {
  return (
    <Frame>
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={2 + i * 40} y={2} width={36} height={52} rx={3} fill="none" stroke={line} />
      ))}
      <rect x={6} y={8} width={28} height={14} rx={2} fill={soft} opacity={0.5} />
      <rect x={46} y={30} width={28} height={18} rx={2} fill={soft} opacity={0.5} />
      <rect x={86} y={10} width={28} height={30} rx={2} fill={color} />
      <rect x={126} y={6} width={28} height={12} rx={2} fill={soft} opacity={0.5} />
      <rect x={126} y={24} width={28} height={24} rx={2} fill={color} opacity={0.55} />
      <rect x={166} y={34} width={28} height={14} rx={2} fill={soft} opacity={0.5} />
    </Frame>
  );
}

/** A doc page beside a sheet with a highlighted total row. */
function DocsGlyph({ color }: GlyphProps) {
  return (
    <Frame>
      <rect x={4} y={3} width={84} height={50} rx={3} fill="none" stroke={line} />
      <rect x={12} y={11} width={44} height={5} rx={1.5} fill={color} />
      {[22, 30, 38, 46].map((y, i) => (
        <rect key={y} x={12} y={y} width={i === 3 ? 38 : 68} height={3} rx={1.5} fill={soft} />
      ))}
      <rect x={104} y={3} width={92} height={50} rx={3} fill="none" stroke={line} />
      {[13, 23, 33].map((y) => (
        <line key={y} x1={104} x2={196} y1={y} y2={y} stroke={line} />
      ))}
      <line x1={140} x2={140} y1={3} y2={43} stroke={line} />
      <rect x={104} y={43} width={92} height={10} fill={color} opacity={0.35} />
      <rect x={110} y={46} width={22} height={4} rx={1.5} fill={color} />
      <rect x={168} y={46} width={22} height={4} rx={1.5} fill={color} />
    </Frame>
  );
}

/** One search box with results of different kinds under it. */
function SearchGlyph({ color }: GlyphProps) {
  return (
    <Frame>
      <rect x={4} y={4} width={192} height={16} rx={3} fill="none" stroke={color} />
      <circle cx={14} cy={12} r={3.5} fill="none" stroke={color} strokeWidth={1.5} />
      <line x1={16.5} x2={19.5} y1={14.5} y2={17.5} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <rect x={26} y={10} width={40} height={4} rx={1.5} fill={color} />
      {[27, 37, 47].map((y, i) => (
        <g key={y}>
          <rect x={6} y={y - 3} width={8} height={8} rx={2} fill={soft} opacity={i === 0 ? 1 : 0.6} />
          <rect x={20} y={y - 1} width={[70, 54, 86][i]} height={4} rx={1.5} fill={soft} opacity={i === 0 ? 1 : 0.6} />
        </g>
      ))}
    </Frame>
  );
}

/** A grid of dashboard cards of mixed sizes, one with a ring. */
function DashboardGlyph({ color }: GlyphProps) {
  return (
    <Frame>
      <rect x={4} y={3} width={60} height={50} rx={3} fill="none" stroke={line} />
      <circle cx={34} cy={30} r={11} fill="none" stroke={line} strokeWidth={4} />
      <path d="M34 19 A11 11 0 1 1 24.3 35.5" fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" />
      <rect x={72} y={3} width={124} height={22} rx={3} fill="none" stroke={line} />
      {[80, 100, 120, 140, 160, 180].map((x, i) => (
        <rect key={x} x={x} y={20 - [6, 10, 8, 14, 11, 5][i]} width={10} height={[6, 10, 8, 14, 11, 5][i]} rx={1} fill={color} opacity={i === 3 ? 1 : 0.5} />
      ))}
      <rect x={72} y={31} width={58} height={22} rx={3} fill="none" stroke={line} />
      <rect x={78} y={37} width={30} height={4} rx={1.5} fill={soft} />
      <rect x={78} y={44} width={44} height={4} rx={1.5} fill={color} />
      <rect x={138} y={31} width={58} height={22} rx={3} fill="none" stroke={line} />
      <rect x={144} y={39} width={40} height={6} rx={1.5} fill={soft} />
    </Frame>
  );
}

/** Seven habit dots, most of them filled, and a goal bar underneath. */
function HabitsGlyph({ color }: GlyphProps) {
  return (
    <Frame>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <g key={i}>
          <circle cx={16 + i * 28} cy={16} r={8} fill={i < 5 ? color : "none"} stroke={color} strokeWidth={1.5} opacity={i < 5 ? 1 : 0.5} />
          {i < 5 ? <path d={`M${12 + i * 28} 16 l3 3 l5 -6`} fill="none" stroke="#06190f" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /> : null}
        </g>
      ))}
      <rect x={8} y={36} width={184} height={10} rx={3} fill={line} />
      <rect x={8} y={36} width={118} height={10} rx={3} fill={color} />
    </Frame>
  );
}

/** List, board and Gantt in a row, the board in the middle. */
function ViewsGlyph({ color }: GlyphProps) {
  return (
    <Frame>
      {[8, 18, 28, 38].map((y, i) => (
        <g key={y}>
          <rect x={4} y={y} width={6} height={6} rx={1.5} fill={i === 0 ? color : "none"} stroke={color} opacity={i === 0 ? 1 : 0.6} />
          <rect x={14} y={y + 1} width={38} height={4} rx={1.5} fill={soft} />
        </g>
      ))}
      {[0, 1, 2].map((c) => (
        <g key={c}>
          <rect x={66 + c * 24} y={4} width={20} height={48} rx={2} fill="none" stroke={line} />
          <rect x={66 + c * 24} y={4} width={20} height={2} fill={color} opacity={0.9 - c * 0.25} />
          {Array.from({ length: [3, 2, 1][c] }).map((_, r) => (
            <rect key={r} x={69 + c * 24} y={11 + r * 13} width={14} height={9} rx={1.5} fill={soft} opacity={0.7} />
          ))}
        </g>
      ))}
      {[[146, 10, 28], [156, 24, 36], [170, 38, 26]].map(([x, y, w]) => (
        <rect key={y} x={x} y={y} width={w} height={8} rx={2} fill={color} opacity={0.8} />
      ))}
      <line x1={162} x2={162} y1={4} y2={52} stroke={line} strokeDasharray="2 2" />
    </Frame>
  );
}

export const FEATURE_GLYPHS: ComponentType<GlyphProps>[] = [
  CalendarGlyph,
  DocsGlyph,
  SearchGlyph,
  DashboardGlyph,
  HabitsGlyph,
  ViewsGlyph,
];
