import { LandingHeader } from "@timely/ui";

// The header's ThemeToggle applies the visitor's theme (saved choice, else the
// system preference) to <html data-landing-theme>, so this card follows it.
// LoopNav (lg+) and "Get the code" (xl+) only show at wide viewports.
export const PageTop = () => (
  <div className="landing" style={{ height: 240 }}>
    <LandingHeader />
    <div className="mx-auto max-w-6xl px-5 pt-12 sm:px-8">
      <p className="l-label l-hue inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-wide">
        An open-source personal planner
      </p>
      <h1 className="l-display mt-5 text-[2.75rem] leading-[1.02] font-extrabold">
        From loose thoughts to a planned week.
      </h1>
    </div>
  </div>
);
