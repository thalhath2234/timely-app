import { EventBlocks, MiniWeek, MiniWindow, SceneBox } from "@timely/ui";
import type { CSSProperties, ReactNode } from "react";

const Landing = ({
  children,
  light = false,
  width = 480,
}: {
  children: ReactNode;
  light?: boolean;
  width?: number;
}) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing l-hue p-8" style={{ width, "--hue": "#6E56CF" } as CSSProperties}>
        <div className="l-stage rounded-[1.75rem] p-4">{children}</div>
      </div>
    </div>
  </div>
);

const Week = () => (
  <div className="absolute inset-0">
    <MiniWindow title="Calendar · Week of 5 Oct" className="h-full">
      <MiniWeek>
        <EventBlocks />
      </MiniWeek>
    </MiniWindow>
  </div>
);

export const CalendarScene = () => (
  <Landing>
    <SceneBox height={260} eager label="A week calendar with this week's events.">
      <Week />
    </SceneBox>
  </Landing>
);

export const ScalesWithWidth = () => (
  <Landing width={340}>
    <SceneBox height={260} eager label="The same scene in a narrower box; everything scales with it.">
      <Week />
    </SceneBox>
  </Landing>
);

export const OnLightCanvas = () => (
  <Landing light>
    <SceneBox height={260} eager label="A week calendar on the light landing canvas.">
      <Week />
    </SceneBox>
  </Landing>
);
