"use client";

import { motion } from "motion/react";
import { Database, Laptop, Lock, Server, Smartphone } from "lucide-react";
import { useFrames } from "./shell";

const PULSE_MS = [2600, 2600] as const;

/** Your computer and your phone, joined over your own Tailscale network. */
function HomeDiagram() {
  const { ref, frame, calm } = useFrames(2, PULSE_MS, 0);
  return (
    <div
      ref={ref}
      className="panel p-5 sm:p-7"
      role="img"
      aria-label="Diagram: the desktop app on your computer runs its own server and PostgreSQL database. Your phone connects to it over your own Tailscale network after pairing by QR code."
    >
      <div className="grid items-stretch gap-4 sm:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,0.8fr)]" aria-hidden>
        <div className="rounded-2xl border border-[var(--line-2)] p-4">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <Laptop className="size-4 text-[var(--mint)]" />
            Your computer
          </p>
          <div className="mt-3 grid gap-2 text-[14px]">
            <span className="flex items-center gap-2.5 rounded-xl bg-[var(--panel-2)] px-3 py-2.5">
              <span className="text-[var(--soft)]">Timely desktop app</span>
            </span>
            <span className="flex items-center gap-2.5 rounded-xl bg-[var(--panel-2)] px-3 py-2.5">
              <Server className="size-4 text-[var(--faint)]" />
              Its own server
            </span>
            <span className="flex items-center gap-2.5 rounded-xl bg-[var(--panel-2)] px-3 py-2.5">
              <Database className="size-4 text-[var(--faint)]" />
              PostgreSQL database
            </span>
            <span className="flex items-center gap-2.5 rounded-xl border border-dashed border-[var(--line-2)] px-3 py-2.5 text-[var(--soft)]">
              <Lock className="size-4 text-[var(--faint)]" />
              Encrypted backups
            </span>
          </div>
        </div>

        <div className="relative flex min-h-16 items-center justify-center sm:w-28 sm:min-h-0">
          <span className="absolute top-0 bottom-0 left-1/2 w-px border-l border-dashed border-[var(--line-3)] sm:top-1/2 sm:right-0 sm:bottom-auto sm:left-0 sm:h-px sm:w-auto sm:border-t sm:border-l-0" />
          {!calm ? (
            <>
              <motion.span
                key={`a${frame}`}
                className="absolute hidden size-2 rounded-full bg-[var(--mint)] sm:block"
                style={{ top: "calc(50% - 4px)" }}
                initial={{ left: "0%", opacity: 0 }}
                animate={{
                  left: frame === 0 ? "calc(100% - 8px)" : "0%",
                  opacity: [0, 1, 1, 0],
                }}
                transition={{ duration: 2.2, ease: "easeInOut" }}
              />
              <motion.span
                key={`b${frame}`}
                className="absolute size-2 rounded-full bg-[var(--mint)] sm:hidden"
                style={{ left: "calc(50% - 4px)" }}
                initial={{ top: "0%", opacity: 0 }}
                animate={{
                  top: frame === 0 ? "calc(100% - 8px)" : "0%",
                  opacity: [0, 1, 1, 0],
                }}
                transition={{ duration: 2.2, ease: "easeInOut" }}
              />
            </>
          ) : null}
          <span className="relative rounded-full border border-[var(--line-2)] bg-[var(--panel)] px-3 py-1 text-[12.5px] text-[var(--soft)]">
            Tailscale
          </span>
        </div>

        <div className="rounded-2xl border border-[var(--line-2)] p-4">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <Smartphone className="size-4 text-[var(--mint)]" />
            Your phone
          </p>
          <div className="mt-3 flex items-center gap-3">
            <QrGlyph />
            <span className="text-[14px] leading-snug text-[var(--soft)]">
              Paired by QR code from Settings › Server
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A decorative QR-like grid (not a real code). */
function QrGlyph() {
  const cells = ["1110111", "1010101", "1110111", "0001000", "1101011", "0110110", "1011101"];
  return (
    <svg
      viewBox="0 0 7 7"
      className="size-14 shrink-0 rounded-md bg-[var(--ink)] p-1"
      aria-hidden
      shapeRendering="crispEdges"
    >
      {cells.flatMap((row, y) =>
        row
          .split("")
          .map((bit, x) =>
            bit === "1" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#0a1210" /> : null,
          ),
      )}
    </svg>
  );
}

const FACTS = [
  {
    title: "It runs at home",
    body: "The desktop app bundles its own server and PostgreSQL database. Your plans live on your computer.",
  },
  {
    title: "Your phone, your network",
    body: "The Android app pairs by QR code and reaches your computer over your own Tailscale network.",
  },
  {
    title: "Encrypted backups",
    body: "Scheduled backups are encrypted. A full JSON export is one click away.",
  },
  {
    title: "Open source",
    body: "Read every line on GitHub, file an issue, or build it yourself.",
  },
];

export default function Private() {
  return (
    <div className="priv">
      <HomeDiagram />
      <ul className="facts">
        {FACTS.map((fact) => (
          <li key={fact.title}>
            <b>{fact.title}</b>
            <span>{fact.body}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
