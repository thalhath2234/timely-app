import { LoopNav } from "@timely/ui";
import type { ReactNode } from "react";

// LoopNav highlights the loop step whose section (#capture, #schedule, ...)
// crosses the middle of the viewport, and stays invisible when none does.
// It renders at lg widths and up only.
const Page = ({ step, children }: { step: string; children: ReactNode }) => (
  <div className="landing">
    <div className="flex h-16 items-center border-b px-8" style={{ borderColor: "var(--l-line)" }}>
      <LoopNav />
    </div>
    <section id={step} className="mx-auto max-w-3xl px-8 py-16" style={{ height: 520 }}>
      {children}
    </section>
  </div>
);

export const OnAutoSchedule = () => (
  <Page step="schedule">
    <h2 className="l-display text-3xl font-bold">Let Timely find the time.</h2>
    <p className="l-soft mt-4 text-base leading-relaxed">
      The Auto-schedule section sits in the middle of the screen, so its step is highlighted.
    </p>
  </Page>
);
