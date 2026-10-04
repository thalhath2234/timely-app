import { FocusScene, LandingStage } from "@timely/ui";
import type { CSSProperties } from "react";

// The landing page's own stage for this scene (see apps/web/app/page.tsx).
const Staged = ({ light = false }: { light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing l-hue px-14 py-14" style={{ "--hue": "#30A66D" } as CSSProperties}>
      <div style={{ width: 520 }}>
        <LandingStage
          sticker="stopwatch"
          stickerSide={"left"}
          shapes={[
            { name: "ring", hue: "#FFB224", className: "-right-6 -bottom-6 size-16 sm:size-20" },
            { name: "pill", hue: "#0090FF", className: "-top-5 right-12 w-16 sm:w-24", tilt: 10 },
          ]}
        >
          <FocusScene />
        </LandingStage>
      </div>
    </div>
  </div>
);

export const OnStage = () => <Staged />;

export const OnLightCanvas = () => <Staged light />;
