import { ClarifyScene, LandingStage } from "@timely/ui";
import type { CSSProperties } from "react";

// The landing page's own stage for this scene (see apps/web/app/page.tsx).
const Staged = ({ light = false }: { light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing l-hue px-14 py-14" style={{ "--hue": "#E93D82" } as CSSProperties}>
      <div style={{ width: 520 }}>
        <LandingStage
          sticker="bell"
          stickerSide={"left"}
          shapes={[
            { name: "dots", hue: "#6E56CF", className: "-right-5 -bottom-6 size-16 sm:size-20" },
            { name: "squiggle", hue: "#30A66D", className: "-top-6 right-10 w-24 sm:w-32", tilt: 6 },
          ]}
        >
          <ClarifyScene />
        </LandingStage>
      </div>
    </div>
  </div>
);

export const OnStage = () => <Staged />;

export const OnLightCanvas = () => <Staged light />;
