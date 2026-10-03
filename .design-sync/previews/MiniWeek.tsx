import { EventBlocks, MiniWeek, MiniWindow, SceneBox } from "@timely/ui";
import type { CSSProperties, ReactNode } from "react";

const Landing = ({
  children,
  light = false,
  height = 260,
}: {
  children: ReactNode;
  light?: boolean;
  height?: number;
}) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing l-hue p-8" style={{ width: 520, "--hue": "#6E56CF" } as CSSProperties}>
        <div className="l-stage rounded-[1.75rem] p-4">
          <SceneBox height={height} eager label="A Mon–Fri week of working hours.">
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

/** Positions a block like the scenes do: 20% per weekday, 12.5% per hour from 09:00. */
const Work = ({
  title,
  day,
  start,
  hours,
  color,
}: {
  title: string;
  day: number;
  start: number;
  hours: number;
  color: string;
}) => (
  <div
    className="absolute p-px"
    style={{ left: `${day * 20}%`, width: "20%", top: `${(start - 9) * 12.5}%`, height: `${hours * 12.5}%` }}
  >
    <div
      className="mini-9 h-full overflow-hidden rounded-sm px-1 py-0.5 font-medium"
      style={{
        background: `color-mix(in oklch, ${color} 24%, var(--card))`,
        borderLeft: `calc(var(--u) * 3) solid ${color}`,
      }}
    >
      <span className="line-clamp-2">{title}</span>
    </div>
  </div>
);

export const EmptyGrid = () => (
  <Landing>
    <MiniWeek />
  </Landing>
);

export const WithEvents = () => (
  <Landing>
    <MiniWeek>
      <EventBlocks />
    </MiniWeek>
  </Landing>
);

export const ScheduledWeek = () => (
  <Landing>
    <MiniWeek>
      <EventBlocks />
      <Work title="Write the launch brief" day={0} start={10} hours={1.5} color="#6E56CF" />
      <Work title="Review the launch checklist" day={0} start={11.5} hours={0.75} color="#6E56CF" />
      <Work title="Design the homepage 1/2" day={1} start={9} hours={3} color="#6E56CF" />
      <Work title="Design the homepage 2/2" day={1} start={13} hours={3} color="#6E56CF" />
      <Work title="Build the launch budget" day={1} start={16} hours={1} color="#6E56CF" />
      <Work title="Test the contact form" day={2} start={9} hours={1} color="#6E56CF" />
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
