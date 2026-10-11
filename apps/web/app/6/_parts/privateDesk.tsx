"use client";

import { motion } from "motion/react";
import { Database, HardDrive, Lock, Server } from "lucide-react";
import { useLoop } from "./motionKit";
import { Tape, noteStyle } from "./paper";

/* A made-up but stable QR-like pattern: three finder squares and a seeded scatter. */
const QR_SIZE = 21;
const QR_CELLS: [number, number][] = (() => {
  const cells: [number, number][] = [];
  let seed = 7;
  const finder = (x: number, y: number) => x < 7 && y < 7;
  for (let y = 0; y < QR_SIZE; y += 1) {
    for (let x = 0; x < QR_SIZE; x += 1) {
      if (finder(x, y) || finder(QR_SIZE - 1 - x, y) || finder(x, QR_SIZE - 1 - y)) continue;
      seed = (seed * 9301 + 49297) % 233280;
      if (seed / 233280 > 0.52) cells.push([x, y]);
    }
  }
  return cells;
})();

/* Points along the dashed link (the same cubic as the path) for the moving dot. */
const PATH_X: number[] = [];
const PATH_Y: number[] = [];
for (let i = 0; i <= 10; i += 1) {
  const t = i / 10;
  const u = 1 - t;
  PATH_X.push(u * u * u * 0 + 3 * u * u * t * 30 + 3 * u * t * t * 70 + t * t * t * 100);
  PATH_Y.push(u * u * u * 10 + 3 * u * u * t * -6 + 3 * u * t * t * 26 + t * t * t * 10);
}

function Finder({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="7" height="7" fill="currentColor" />
      <rect x="1" y="1" width="5" height="5" fill="#f3ead6" />
      <rect x="2" y="2" width="3" height="3" fill="currentColor" />
    </g>
  );
}

function Qr() {
  return (
    <svg viewBox={`-1 -1 ${QR_SIZE + 2} ${QR_SIZE + 2}`} className="size-full text-[var(--paper-ink)]" shapeRendering="crispEdges">
      <rect x="-1" y="-1" width={QR_SIZE + 2} height={QR_SIZE + 2} fill="#f3ead6" />
      <Finder x={0} y={0} />
      <Finder x={QR_SIZE - 7} y={0} />
      <Finder x={0} y={QR_SIZE - 7} />
      {QR_CELLS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  );
}

export function PrivateGraphic() {
  const { ref, frame, playing } = useLoop(4, [1600, 1600, 1600, 1600], 3);
  return (
    <div
      ref={ref}
      role="img"
      aria-label="A laptop running the Timely desktop app with its own server and PostgreSQL database, linked over your Tailscale network to a phone that paired by scanning a QR code."
      className="relative mx-auto grid w-full max-w-[620px] grid-cols-[1fr_auto_0.62fr] items-center gap-2 sm:gap-4"
    >
      {/* The computer */}
      <div aria-hidden className="relative">
        <div className="rounded-t-xl border-[3px] border-[#3a3832] bg-[#121110] p-3">
          <p className="d6-display text-[0.8rem] font-bold text-[var(--soft)]">Timely desktop app</p>
          <div className="mt-2 space-y-1.5">
            <span className="d6-note flex items-center gap-1.5 px-2 py-1.5 text-[0.75rem] font-bold" style={noteStyle("violet", -1.5)}>
              <Server className="size-3.5 shrink-0" /> Its own server
            </span>
            <span className="d6-note flex items-center gap-1.5 px-2 py-1.5 text-[0.75rem] font-bold" style={noteStyle("blue", 1)}>
              <Database className="size-3.5 shrink-0" /> PostgreSQL
            </span>
            <span className="d6-note flex items-center gap-1.5 px-2 py-1.5 text-[0.75rem] font-bold" style={noteStyle("green", -0.5)}>
              <Lock className="size-3.5 shrink-0" /> Encrypted backup
            </span>
          </div>
        </div>
        <div className="mx-[-6%] h-3 rounded-b-lg bg-[#3a3832]" />
      </div>

      {/* The link */}
      <div aria-hidden className="relative flex w-12 flex-col items-center sm:w-24">
        <svg viewBox="0 0 100 20" className="w-full overflow-visible text-[var(--n-yellow)]">
          <path d="M0 10 C 30 -6, 70 26, 100 10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="5 6" strokeLinecap="round" />
          {playing ? (
            <motion.circle
              r="4.5"
              fill="currentColor"
              initial={false}
              animate={frame % 2 ? { cx: [...PATH_X].reverse(), cy: [...PATH_Y].reverse() } : { cx: PATH_X, cy: PATH_Y }}
              transition={{ duration: 1.4, ease: "easeInOut" }}
            />
          ) : null}
        </svg>
        <span className="d6-mono mt-2 text-center text-[0.62rem] leading-tight text-[var(--soft)] sm:text-[0.7rem]">
          your Tailscale
          <br />
          network
        </span>
      </div>

      {/* The phone */}
      <div aria-hidden className="relative mx-auto w-full max-w-[150px]">
        <div className="rounded-[22px] border-[3px] border-[#3a3832] bg-[#121110] p-2 pt-4">
          <p className="text-center text-[0.68rem] font-bold text-[var(--soft)]">Pair with computer</p>
          <div className="relative mt-2 overflow-hidden rounded-md">
            <Qr />
            <span className="d6-scanline absolute inset-x-0 h-[3px] bg-[#e5484d]/80 shadow-[0_0_8px_#e5484d]" />
          </div>
          <p className="mt-2 text-center text-[0.68rem] font-bold text-[var(--n-green)]">{frame >= 2 ? "Paired" : "Scanning…"}</p>
        </div>
      </div>
    </div>
  );
}

const POINTS = [
  { icon: HardDrive, title: "Runs on your computer", text: "The desktop app bundles its own server and PostgreSQL database. Your plans live there." },
  { icon: Server, title: "Phone over your own network", text: "The Android app pairs by QR code and reaches your computer over your own Tailscale network." },
  { icon: Lock, title: "Encrypted backups", text: "Back up and restore your data, encrypted." },
];

export function PrivatePoints() {
  return (
    <ul className="mt-8 space-y-5">
      {POINTS.map((point) => (
        <li key={point.title} className="flex gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--line-2)] text-[var(--n-yellow)]">
            <point.icon className="size-5" />
          </span>
          <span>
            <span className="d6-display block text-[1.15rem] font-bold">{point.title}</span>
            <span className="d6-soft mt-0.5 block leading-relaxed">{point.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OpenSourceNote({ href, version }: { href: string; version: string }) {
  return (
    <a
      href={href}
      className="d6-note group relative mt-10 inline-flex max-w-sm flex-col px-5 pt-4 pb-4 transition-transform hover:-translate-y-1"
      style={noteStyle("cream", -1.5)}
    >
      <Tape className="-top-3 left-6 rotate-[-8deg] !w-14" />
      <span className="d6-hand text-[1.3rem] leading-tight font-bold">Open source. Read every line.</span>
      <span className="mt-1 text-[0.9rem] font-medium text-[var(--paper-soft)]">
        {href.replace("https://", "")} · v{version}
      </span>
    </a>
  );
}
