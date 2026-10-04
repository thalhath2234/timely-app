import { HeroScene, LandingStage } from "@timely/ui";
import type { CSSProperties } from "react";

// The landing page's own stage for this scene (see apps/web/app/page.tsx).
const Staged = ({ light = false }: { light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing l-hue px-14 py-14" style={{ "--hue": "#6E56CF" } as CSSProperties}>
      <div style={{ width: 520 }}>
        <LandingStage
          sticker="sparkle"
          stickerSide={"right"}
          shapes={[
            { name: "blob", hue: "#E93D82", className: "-left-8 -top-8 size-24 sm:-left-12 sm:size-32", tilt: 12 },
            { name: "squiggle", hue: "#FFB224", className: "-bottom-7 right-8 w-28 sm:w-36" },
            { name: "plus", hue: "#30A66D", className: "-bottom-4 -left-3 size-9 sm:size-11", tilt: 14 },
          ]}
        >
          <HeroScene />
        </LandingStage>
      </div>
    </div>
  </div>
);

export const OnStage = () => <Staged />;

export const OnLightCanvas = () => <Staged light />;
