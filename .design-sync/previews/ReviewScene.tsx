import { ReviewScene, LandingStage } from "@timely/ui";
import type { CSSProperties } from "react";

// The landing page's own stage for this scene (see apps/web/app/page.tsx).
const Staged = ({ light = false }: { light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing l-hue px-14 py-14" style={{ "--hue": "#0090FF" } as CSSProperties}>
      <div style={{ width: 520 }}>
        <LandingStage
          sticker="chart"
          stickerSide={"right"}
          shapes={[
            { name: "squiggle", hue: "#E93D82", className: "-bottom-7 left-8 w-24 sm:w-32", tilt: -4 },
            { name: "dots", hue: "#30A66D", className: "-top-6 -left-5 size-14 sm:size-16" },
          ]}
        >
          <ReviewScene />
        </LandingStage>
      </div>
    </div>
  </div>
);

export const OnStage = () => <Staged />;

export const OnLightCanvas = () => <Staged light />;
