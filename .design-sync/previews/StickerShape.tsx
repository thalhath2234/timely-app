import { StickerShape } from "@timely/ui";
import type { CSSProperties, ReactNode } from "react";

const SHAPES = [
  { name: "blob", hue: "#E93D82", w: 80, h: 80, tilt: 12 },
  { name: "squiggle", hue: "#FFB224", w: 128, h: 32, tilt: 0 },
  { name: "ring", hue: "#0090FF", w: 72, h: 72, tilt: 0 },
  { name: "dots", hue: "#6E56CF", w: 72, h: 72, tilt: 0 },
  { name: "plus", hue: "#30A66D", w: 56, h: 56, tilt: 14 },
  { name: "pill", hue: "#12A594", w: 96, h: 40, tilt: -8 },
] as const;

const Landing = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing grid grid-cols-3 gap-8 p-8" style={{ width: 560 }}>
        {children}
      </div>
    </div>
  </div>
);

const Swatches = () =>
  SHAPES.map((shape) => (
    <div key={shape.name} className="flex flex-col items-center gap-3">
      <div className="relative flex items-center justify-center" style={{ width: 128, height: 88 }}>
        <StickerShape
          name={shape.name}
          tilt={shape.tilt}
          className=""
          style={{ "--hue": shape.hue, width: shape.w, height: shape.h, position: "relative" } as CSSProperties}
        />
      </div>
      <span className="l-soft font-mono text-xs">{shape.name}</span>
    </div>
  ));

export const DarkCanvas = () => (
  <Landing>
    <Swatches />
  </Landing>
);

export const LightCanvas = () => (
  <Landing light>
    <Swatches />
  </Landing>
);
