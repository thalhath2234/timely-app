import { DocsSheetsScene, LandingStage } from "@timely/ui";
import type { CSSProperties } from "react";

// The landing page's own stage for this scene (see apps/web/app/page.tsx).
const Staged = ({ light = false }: { light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing l-hue px-14 py-14" style={{ "--hue": "#12A594" } as CSSProperties}>
      <div style={{ width: 520 }}>
        <LandingStage
          sticker="pencil"
          stickerSide={"right"}
          shapes={[
            { name: "ring", hue: "#E93D82", className: "-bottom-6 -left-6 size-16 sm:size-20" },
            { name: "pill", hue: "#FFB224", className: "-top-5 left-10 w-16 sm:w-24", tilt: 6 },
          ]}
        >
          <DocsSheetsScene />
        </LandingStage>
      </div>
    </div>
  </div>
);

export const OnStage = () => <Staged />;

export const OnLightCanvas = () => <Staged light />;
