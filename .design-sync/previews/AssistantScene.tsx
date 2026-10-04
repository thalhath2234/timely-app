import { AssistantScene, LandingStage } from "@timely/ui";
import type { CSSProperties } from "react";

// The landing page's own stage for this scene (see apps/web/app/page.tsx).
const Staged = ({ light = false }: { light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing l-hue px-14 py-14" style={{ "--hue": "#AB4ABA" } as CSSProperties}>
      <div style={{ width: 520 }}>
        <LandingStage
          sticker="chat"
          stickerSide={"left"}
          shapes={[
            { name: "blob", hue: "#12A594", className: "-right-8 -bottom-8 size-20 sm:size-28", tilt: 30 },
            { name: "plus", hue: "#FFB224", className: "-top-5 right-12 size-8 sm:size-10", tilt: 12 },
          ]}
        >
          <AssistantScene />
        </LandingStage>
      </div>
    </div>
  </div>
);

export const OnStage = () => <Staged />;

export const OnLightCanvas = () => <Staged light />;
