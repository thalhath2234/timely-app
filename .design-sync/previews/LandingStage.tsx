import { HeroScene, LandingStage, MiniWindow, SceneBox } from "@timely/ui";
import type { CSSProperties, ReactNode } from "react";

const Landing = ({
  children,
  light = false,
  hue = "#6E56CF",
}: {
  children: ReactNode;
  light?: boolean;
  hue?: string;
}) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing l-hue relative px-14 py-14" style={{ width: 660, "--hue": hue } as CSSProperties}>
        {children}
      </div>
    </div>
  </div>
);

export const HeroStage = () => (
  <Landing>
    <LandingStage
      sticker="sparkle"
      shapes={[
        { name: "blob", hue: "#E93D82", className: "-left-8 -top-8 size-24 sm:-left-12 sm:size-32", tilt: 12 },
        { name: "squiggle", hue: "#FFB224", className: "-bottom-7 right-8 w-28 sm:w-36" },
        { name: "plus", hue: "#30A66D", className: "-bottom-4 -left-3 size-9 sm:size-11", tilt: 14 },
      ]}
    >
      <HeroScene />
    </LandingStage>
  </Landing>
);

const Placeholder = ({ title }: { title: string }) => (
  <SceneBox height={180} eager label={title}>
    <div className="absolute inset-0">
      <MiniWindow title={title} className="h-full">
        <div className="mini-11 space-y-1.5 p-3">
          {["Write the launch brief", "Review the launch checklist", "Renew the domain"].map((line) => (
            <div key={line} className="rounded-md border border-border bg-card px-2.5 py-1.5">
              {line}
            </div>
          ))}
        </div>
      </MiniWindow>
    </div>
  </SceneBox>
);

export const StickerLeft = () => (
  <Landing hue="#E93D82">
    <LandingStage
      sticker="bell"
      stickerSide="left"
      shapes={[
        { name: "dots", hue: "#6E56CF", className: "-right-5 -bottom-6 size-16 sm:size-20" },
        { name: "squiggle", hue: "#30A66D", className: "-top-6 right-10 w-24 sm:w-32", tilt: 6 },
      ]}
    >
      <Placeholder title="Clarify · Inbox" />
    </LandingStage>
  </Landing>
);

export const OnLightCanvas = () => (
  <Landing light hue="#FFB224">
    <LandingStage
      sticker="tray"
      shapes={[
        { name: "ring", hue: "#0090FF", className: "-bottom-6 -left-5 size-14 sm:size-20" },
        { name: "pill", hue: "#E93D82", className: "-top-5 left-10 w-16 sm:w-24", tilt: -8 },
      ]}
    >
      <Placeholder title="Inbox" />
    </LandingStage>
  </Landing>
);
