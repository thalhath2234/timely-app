import { Sticker } from "@timely/ui";
import type { CSSProperties, ReactNode } from "react";

const NAMES = [
  ["tray", "#FFB224"],
  ["bell", "#E93D82"],
  ["calendar", "#6E56CF"],
  ["stopwatch", "#30A66D"],
  ["chart", "#0090FF"],
  ["chat", "#AB4ABA"],
  ["pencil", "#12A594"],
  ["magnifier", "#F76808"],
  ["phone", "#3E63DD"],
  ["star", "#99D52A"],
  ["sparkle", "#6E56CF"],
] as const;

const Landing = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing grid gap-6 p-8" style={{ width: 600, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {children}
      </div>
    </div>
  </div>
);

const Cell = ({ name, hue }: { name: (typeof NAMES)[number][0]; hue: string }) => (
  <div className="l-hue flex flex-col items-center gap-2" style={{ "--hue": hue } as CSSProperties}>
    <div className="relative" style={{ width: 80, height: 80 }}>
      <Sticker name={name} tilt={-6} className="inset-0 size-20" />
    </div>
    <span className="l-soft font-mono text-xs">{name}</span>
  </div>
);

export const AllStickers = () => (
  <Landing>
    {NAMES.map(([name, hue]) => (
      <Cell key={name} name={name} hue={hue} />
    ))}
  </Landing>
);

export const OnLightCanvas = () => (
  <Landing light>
    {NAMES.slice(0, 4).map(([name, hue]) => (
      <Cell key={name} name={name} hue={hue} />
    ))}
  </Landing>
);
