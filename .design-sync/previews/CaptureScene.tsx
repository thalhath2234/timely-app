import { CaptureScene, LandingStage } from "@timely/ui";
import type { CSSProperties } from "react";

// The landing page's own stage for this scene (see apps/web/app/page.tsx).
const Staged = ({ light = false }: { light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing l-hue px-14 py-14" style={{ "--hue": "#FFB224" } as CSSProperties}>
      <div style={{ width: 520 }}>
        <LandingStage
          sticker="tray"
          stickerSide={"right"}
          shapes={[
            { name: "ring", hue: "#0090FF", className: "-bottom-6 -left-5 size-14 sm:size-20" },
            { name: "pill", hue: "#E93D82", className: "-top-5 left-10 w-16 sm:w-24", tilt: -8 },
          ]}
        >
          <CaptureScene />
        </LandingStage>
      </div>
    </div>
  </div>
);

export const OnStage = () => <Staged />;

export const OnLightCanvas = () => <Staged light />;
