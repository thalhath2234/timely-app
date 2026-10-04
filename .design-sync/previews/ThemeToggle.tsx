import { ThemeToggle } from "@timely/ui";
import type { CSSProperties } from "react";

// ThemeToggle applies the visitor's theme (saved choice, else system preference)
// to <html data-landing-theme>, so every .landing on the page follows it.
export const InHeaderActions = () => (
  <div className="landing l-hue p-8" style={{ "--hue": "#6E56CF" } as CSSProperties}>
    <div className="flex items-center gap-2">
      <ThemeToggle />
      <span className="l-soft rounded-full px-3 py-2 text-sm font-medium">Sign In</span>
      <span className="l-ghost rounded-full px-4 py-2 text-sm font-semibold">Register</span>
    </div>
  </div>
);

export const Alone = () => (
  <div className="landing flex items-center gap-3 p-8">
    <ThemeToggle />
    <span className="l-soft text-sm">Switch between dark and light theme</span>
  </div>
);
