"use client";

import { Clock } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { listContainerVariants, listItemVariants, springSoft } from "@/app/_components/_ui/motion";

const SESSION_ROWS = [
  { title: "Q3 Financial Model Calculation", time: "09:00 AM", active: true },
  { title: "Distributed Pipelines Validation", time: "11:30 AM", active: false },
  { title: "Deep Focus · Engineering Ledger", time: "02:00 PM", active: false },
];

export default function AuthBrandPanel() {
  return (
    <section className="relative z-10 hidden flex-col justify-between border-r border-white/10 bg-[#0c0e14] p-10 lg:p-14 md:flex md:w-[42%] lg:w-[40%]">
      <Link href="/" aria-label="Timely home" className="flex items-center gap-3 self-start rounded-lg">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#c0c1ff] text-[#1000a9] shadow-sm">
          <span className="text-sm font-bold select-none">T</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[1.25rem] font-semibold leading-tight tracking-tight text-[#e2e2eb]">
            Timely
          </span>
          <span className="text-[0.6875rem] font-medium tracking-[0.02em] text-[#908fa0]">
            Productivity & Sheets Workspace
          </span>
        </div>
      </Link>

      <motion.div
        className="max-w-md py-12"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
      >
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#282a30] px-2.5 py-1">
          <span className="size-1.5 rounded-full bg-[#4edea3]" />
          <span className="text-[0.6875rem] font-medium tracking-[0.02em] text-[#c7c4d7]">
            Local-first Workspace Engine
          </span>
        </div>
        <h1 className="text-[2.25rem] font-bold leading-[2.75rem] tracking-[-0.03em] text-[#e2e2eb]">
          Clarity of mind starts with masterfully calibrated time.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-[#908fa0]">
          A unified local-first workspace for tasks, computational sheets, and
          synchronous document streams.
        </p>

        <div className="mt-10 space-y-4 rounded-lg border border-white/10 bg-[#191b22]/60 p-5">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5 font-mono text-xs text-[#908fa0]">
            <span className="flex items-center gap-1.5">
              <Clock className="size-4 text-[#c0c1ff]" />
              SESSION CALIBRATION
            </span>
            <span className="text-[#4edea3]">SYNCHRONIZED</span>
          </div>
          <motion.div
            className="space-y-3 pt-1"
            variants={listContainerVariants}
            initial="hidden"
            animate="visible"
          >
            {SESSION_ROWS.map((row) => (
              <motion.div
                key={row.title}
                variants={listItemVariants}
                className="flex items-center gap-3"
              >
                <div
                  className={`size-1.5 rounded-full ${row.active ? "bg-[#c0c1ff]" : "bg-[#464554]"}`}
                />
                <div className="flex flex-1 items-center justify-between gap-3">
                  <span
                    className={`text-xs ${row.active ? "font-medium text-[#e2e2eb]" : "text-[#908fa0]"}`}
                  >
                    {row.title}
                  </span>
                  <span className="font-mono text-xs text-[#908fa0] tabular-nums">
                    {row.time}
                  </span>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.div>

      <div className="flex items-center justify-between border-t border-white/[0.08] pt-6">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-[#4edea3]" />
          <span className="font-mono text-xs text-[#908fa0]">
            Timely Core · Local-first & encrypted
          </span>
        </div>
        <span className="font-mono text-xs text-[#464554]">256-bit AES</span>
      </div>
    </section>
  );
}
