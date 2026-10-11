"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { useReduced } from "./hooks";

function Num({ n }: { n: number }) {
  return (
    <span className="d2-mono inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-[var(--verm)] text-[10px] text-[var(--verm-2)]">
      {n}
    </span>
  );
}

/** A small QR code drawn from a fixed pattern. */
function Qr() {
  const cells = Array.from({ length: 121 }, (_, index) => ((index * 37 + (index >> 2) * 11 + (index % 5) * 3) % 7 < 3 ? "1" : "0"));
  return (
    <svg viewBox="0 0 11 11" className="size-16" aria-hidden>
      {cells.map((cell, index) =>
        cell === "1" ? <rect key={index} x={index % 11} y={Math.floor(index / 11)} width={1} height={1} fill="currentColor" /> : null,
      )}
      {[
        [0, 0],
        [8, 0],
        [0, 8],
      ].map(([x, y]) => (
        <g key={`${x}${y}`}>
          <rect x={x} y={y} width={3} height={3} fill="var(--sheet)" />
          <rect x={x + 0.25} y={y + 0.25} width={2.5} height={2.5} fill="none" stroke="currentColor" strokeWidth={0.5} />
          <rect x={x + 1} y={y + 1} width={1} height={1} fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

/**
 * A manual-style diagram: the desktop app with its own server and database,
 * a dashed line over your Tailscale network, and the paired phone. The line
 * draws when it comes into view, then a packet travels along it.
 */
export default function PrivacyFigure() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduced = useReduced();
  const drawn = inView || reduced;
  return (
    <div
      ref={ref}
      role="img"
      aria-label="Diagram: your computer runs the Timely desktop app with its own server and PostgreSQL database and keeps encrypted backups. A dashed line labelled your own Tailscale network connects it to your phone, which was paired by QR code."
      className="flex flex-col items-stretch gap-0 sm:flex-row sm:items-center"
    >
      {/* Computer */}
      <div className="d2-sheet relative min-w-0 flex-[1.5] border border-[var(--rule-3)] p-4 sm:p-5">
        <p className="d2-kicker">Your computer</p>
        <p className="d2-serif mt-1 text-[1.35rem]">Timely desktop app</p>
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="border border-[var(--ink-2)] px-3 py-3 text-center">
            <span className="flex items-center justify-center gap-2">
              <Num n={1} />
              <span className="font-medium">Server</span>
            </span>
            <span className="d2-mono mt-1 block text-[10px] text-[var(--ink-3)]">this computer only</span>
          </div>
          <svg viewBox="0 0 30 10" className="w-8" aria-hidden>
            <motion.path d="M0 5 H30" stroke="var(--ink-2)" strokeWidth="1.2" initial={false} animate={{ pathLength: drawn ? 1 : 0 }} transition={{ duration: 0.4 }} />
          </svg>
          <div className="border border-[var(--ink-2)] px-3 py-3 text-center">
            <span className="font-medium">PostgreSQL</span>
            <span className="d2-mono mt-1 block text-[10px] text-[var(--ink-3)]">app data folder</span>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-dashed border-[var(--rule-2)] pt-3">
          <span aria-hidden className="relative h-7 w-6">
            <span className="absolute inset-0 translate-x-1 -translate-y-1 border border-[var(--rule-3)]" />
            <span className="absolute inset-0 translate-x-0.5 -translate-y-0.5 border border-[var(--rule-3)] bg-[var(--sheet)]" />
            <span className="absolute inset-0 border border-[var(--ink-2)] bg-[var(--sheet)]" />
          </span>
          <Num n={3} />
          <span className="text-sm">Encrypted backups, on a schedule</span>
        </div>
      </div>

      {/* Network */}
      <div className="relative flex h-28 shrink-0 items-center justify-center sm:h-auto sm:w-44 sm:flex-col lg:w-60">
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-0 origin-top border-l-2 border-dashed border-[var(--verm)] sm:hidden"
          initial={false}
          animate={{ scaleY: drawn ? 1 : 0 }}
          transition={{ duration: 0.9, delay: 0.3, ease: "easeInOut" }}
        />
        <motion.span
          aria-hidden
          className="absolute inset-x-0 top-1/2 hidden h-0 origin-left border-t-2 border-dashed border-[var(--verm)] sm:block"
          initial={false}
          animate={{ scaleX: drawn ? 1 : 0 }}
          transition={{ duration: 0.9, delay: 0.3, ease: "easeInOut" }}
        />
        {drawn && !reduced ? (
          <motion.span
            aria-hidden
            className="absolute top-1/2 hidden size-2.5 -translate-y-1/2 bg-[var(--verm)] sm:block"
            initial={{ left: "0%" }}
            animate={{ left: ["0%", "97%", "0%"] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
          />
        ) : null}
        <span className="relative flex items-center gap-2 bg-[var(--paper)] px-2 py-1 text-center">
          <Num n={2} />
          <span className="d2-hand text-[1.3rem] leading-none text-[var(--verm-2)]">your own Tailscale network</span>
        </span>
      </div>

      {/* Phone */}
      <div className="d2-sheet mx-auto flex w-[180px] shrink-0 flex-col items-center rounded-[22px] border border-[var(--rule-3)] px-4 pt-5 pb-4 text-center sm:mx-0">
        <span aria-hidden className="mb-3 h-1 w-10 rounded-full bg-[var(--rule-3)]" />
        <p className="d2-kicker">Your phone</p>
        <div className="mt-3 border border-[var(--rule-2)] bg-[var(--sheet)] p-1.5 text-[var(--ink)]">
          <Qr />
        </div>
        <p className="mt-3 text-sm">Paired by QR code</p>
        <p className="d2-mono mt-1 text-[10px] text-[var(--ink-3)]">Android app</p>
      </div>
    </div>
  );
}
