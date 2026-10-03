import { QuickStart } from "@timely/ui";
import type { CSSProperties, ReactNode } from "react";

const Landing = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing l-hue p-8" style={{ width: 720, "--hue": "#6E56CF" } as CSSProperties}>
        {children}
      </div>
    </div>
  </div>
);

export const RunItYourself = () => (
  <Landing>
    <h2 className="l-display text-4xl font-extrabold text-center">Run it yourself.</h2>
    <p className="l-soft mx-auto mt-4 max-w-xl text-base leading-relaxed text-center">
      Three commands start it. You need Node 22, Go 1.25 and PostgreSQL with pgvector.
    </p>
    <div className="mt-8">
      <QuickStart />
    </div>
  </Landing>
);

export const OnLightCanvas = () => (
  <Landing light>
    <QuickStart />
  </Landing>
);
