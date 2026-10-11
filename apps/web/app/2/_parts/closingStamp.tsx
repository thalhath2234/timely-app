"use client";

import { useRef } from "react";
import { useInView } from "motion/react";
import { Stamp } from "./ink";
import { useReduced } from "./hooks";

/** A large stamp that lands once the back cover scrolls into view. */
export default function ClosingStamp({ version }: { version: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.6, once: true });
  const reduced = useReduced();
  return (
    <div ref={ref} aria-hidden className="relative mx-auto flex h-[200px] w-full max-w-[360px] items-center justify-center sm:h-[230px]">
      <Stamp on={inView || reduced} angle={-9} className="!relative px-5 pt-4 pb-3 text-center whitespace-nowrap">
        <span className="d2-mono block text-[11px] font-medium tracking-[0.3em]">Edition {version}</span>
        <span className="mt-2 block text-[2.6rem] sm:text-[3.8rem]">Scheduled</span>
        <span className="d2-mono mt-2 block border-t-2 border-current pt-2 text-[10px] font-medium tracking-[0.24em]">
          Open source · Your own computer
        </span>
      </Stamp>
    </div>
  );
}
