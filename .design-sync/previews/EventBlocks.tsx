import { EventBlocks, MiniWeek, MiniWindow, SceneBox } from "@timely/ui";
import type { CSSProperties, ReactNode } from "react";

const Landing = ({
  children,
  light = false,
  width = 520,
  height = 260,
}: {
  children: ReactNode;
  light?: boolean;
  width?: number;
  height?: number;
}) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing l-hue p-8" style={{ width, "--hue": "#0090FF" } as CSSProperties}>
        <div className="l-stage rounded-[1.75rem] p-4">
          <SceneBox height={height} eager label="This week's events on the calendar.">
            <div className="absolute inset-0">
              <MiniWindow title="Calendar · Week of 5 Oct" className="h-full">
                {children}
              </MiniWindow>
            </div>
          </SceneBox>
        </div>
      </div>
    </div>
  </div>
);

export const Default = () => (
  <Landing>
    <MiniWeek>
      <EventBlocks />
    </MiniWeek>
  </Landing>
);

export const Compact = () => (
  <Landing height={180}>
    <MiniWeek>
      <EventBlocks compact />
    </MiniWeek>
  </Landing>
);

export const OnLightCanvas = () => (
  <Landing light>
    <MiniWeek>
      <EventBlocks />
    </MiniWeek>
  </Landing>
);
