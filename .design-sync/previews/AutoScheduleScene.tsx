import { AutoScheduleScene, LandingStage } from "@timely/ui";
import type { CSSProperties } from "react";

// The landing page's own stage for this scene (see apps/web/app/page.tsx).
const Staged = ({ light = false }: { light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing l-hue px-14 py-14" style={{ "--hue": "#6E56CF" } as CSSProperties}>
      <div style={{ width: 520 }}>
        <LandingStage
          sticker="calendar"
          stickerSide={"right"}
          shapes={[
            { name: "blob", hue: "#FFB224", className: "-bottom-8 -left-8 size-20 sm:size-28", tilt: -20 },
            { name: "plus", hue: "#E93D82", className: "-top-5 left-12 size-8 sm:size-10", tilt: 20 },
          ]}
        >
          <AutoScheduleScene />
        </LandingStage>
      </div>
    </div>
  </div>
);

export const OnStage = () => <Staged />;

export const OnLightCanvas = () => <Staged light />;
