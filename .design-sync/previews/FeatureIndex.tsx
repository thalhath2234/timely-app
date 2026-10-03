import { FeatureIndex } from "@timely/ui";
import type { CSSProperties, ReactNode } from "react";

const Landing = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing l-hue px-6 py-6" style={{ "--hue": "#99D52A" } as CSSProperties}>
        {children}
      </div>
    </div>
  </div>
);

export const EverythingElse = () => (
  <Landing>
    <div className="text-center">
      <p className="l-label inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-wide">Everything else</p>
      <h2 className="l-display mt-4 text-3xl font-bold">The rest of what is in the box.</h2>
    </div>
    <div className="mt-10">
      <FeatureIndex />
    </div>
  </Landing>
);

export const OnLightCanvas = () => (
  <Landing light>
    <FeatureIndex />
  </Landing>
);
