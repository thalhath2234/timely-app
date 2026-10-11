"use client";

import { motion } from "motion/react";
import { Database, Lock, Monitor, Server, ShieldCheck, Smartphone } from "lucide-react";
import { useLoop } from "@/app/_components/site/motion";

/**
 * Desktop hosts everything; the phone pairs to it by QR and reaches it over
 * Tailscale. Light pulses run both ways along the link.
 */
export default function SyncDiagram() {
  const { ref, frame } = useLoop(3, [1800, 1600, 2400], 2);
  return (
    <div ref={ref} className="relative grid items-center gap-6 md:grid-cols-[1fr_auto_0.7fr]" aria-hidden>
      {/* Desktop */}
      <div className="rounded-2xl border border-white/10 bg-[#111319] p-4 shadow-[0_30px_80px_-40px_rgba(129,131,244,0.6)]">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Monitor className="size-4 text-[var(--s-primary)]" />
          Your computer
        </p>
        <div className="mt-4 space-y-2">
          {[
            { icon: Monitor, label: "Timely app", note: "window and tray" },
            { icon: Server, label: "Timely server", note: "127.0.0.1 only" },
            { icon: Database, label: "PostgreSQL 17", note: "in your app data folder" },
          ].map((layer, index) => (
            <motion.div
              key={layer.label}
              className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5"
              initial={false}
              animate={{
                borderColor: frame === 0 && index === 2 ? "rgba(192,193,255,0.45)" : "rgba(255,255,255,0.07)",
              }}
            >
              <layer.icon className="size-4 text-white/55" />
              <span className="text-sm text-white/85">{layer.label}</span>
              <span className="ml-auto text-xs text-white/40">{layer.note}</span>
            </motion.div>
          ))}
        </div>
        <p className="mt-4 flex items-center gap-2 text-xs text-white/45">
          <Lock className="size-3.5" />
          Secrets sealed with your system keyring
        </p>
      </div>

      {/* Link */}
      <div className="relative mx-auto flex h-24 w-full items-center justify-center md:h-auto md:w-44">
        <svg viewBox="0 0 176 60" className="absolute inset-0 hidden h-full w-full md:block" preserveAspectRatio="none">
          <path d="M0 30 C 60 30, 116 30, 176 30" stroke="rgb(255 255 255 / 10%)" strokeWidth="2" fill="none" />
          <path className="s-beam" pathLength={1} d="M0 30 C 60 30, 116 30, 176 30" stroke="#c0c1ff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path
            className="s-beam"
            style={{ animationDirection: "reverse", animationDelay: "-2.7s" }}
            pathLength={1}
            d="M0 30 C 60 30, 116 30, 176 30"
            stroke="#4edea3"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
        <svg viewBox="0 0 60 96" className="absolute inset-0 h-full w-full md:hidden" preserveAspectRatio="none">
          <path d="M30 0 V 96" stroke="rgb(255 255 255 / 10%)" strokeWidth="2" fill="none" />
          <path className="s-beam" pathLength={1} d="M30 0 V 96" stroke="#c0c1ff" strokeWidth="2.5" fill="none" />
        </svg>
        <span className="relative flex items-center gap-1.5 rounded-full border border-white/10 bg-[var(--s-bg)] px-3 py-1.5 text-xs font-medium text-white/70">
          <ShieldCheck className="size-3.5 text-[#4edea3]" />
          Tailscale
        </span>
      </div>

      {/* Phone */}
      <div className="mx-auto w-full max-w-[220px]">
        <div className="rounded-[28px] border border-white/12 bg-[#111319] p-2 shadow-[0_30px_80px_-40px_rgba(78,222,163,0.5)]">
          <div className="rounded-[22px] border border-white/[0.06] bg-[#0c0d12] px-3.5 pt-3 pb-4">
            <div className="mx-auto h-1 w-10 rounded-full bg-white/15" />
            <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold">
              <Smartphone className="size-4 text-[#4edea3]" />
              Today
            </p>
            <div className="mt-3 space-y-1.5">
              {["Book the moving van", "Send October invoices", "Spanish lesson 12"].map((task, index) => (
                <motion.div
                  key={task}
                  className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2 text-[11px] text-white/80"
                  initial={false}
                  animate={{ opacity: frame >= 1 || index === 0 ? 1 : 0.35 }}
                  transition={{ delay: index * 0.15 }}
                >
                  <motion.span
                    className="size-3 rounded-full border border-white/30"
                    initial={false}
                    animate={{ backgroundColor: frame === 2 && index === 0 ? "#4edea3" : "rgba(0,0,0,0)" }}
                  />
                  {task}
                </motion.div>
              ))}
            </div>
            <motion.p
              className="mt-3 text-center text-[10px] text-[#4edea3]"
              initial={false}
              animate={{ opacity: frame === 2 ? 1 : 0 }}
            >
              Synced with your computer
            </motion.p>
          </div>
        </div>
      </div>
    </div>
  );
}
