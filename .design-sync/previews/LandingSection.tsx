import { AutoScheduleScene, FocusScene, LandingSection } from "@timely/ui";
import type { ReactNode } from "react";

const Landing = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">{children}</div>
  </div>
);

export const ScheduleStep = () => (
  <Landing>
    <LandingSection
      id="schedule"
      hue="#6E56CF"
      label="Auto-schedule"
      step={3}
      headline="Let Timely find the time."
      body="Auto-schedule places your Work inside your Working hours, around the Events you already have. Preview what would change, apply it, and undo it if you disagree."
      points={[
        "Orders work by deadline, priority and what is blocking what.",
        "Says in plain language why something could not be placed.",
        "Events and blocks you placed yourself stay where they are.",
      ]}
      sticker="calendar"
      shapes={[
        { name: "blob", hue: "#FFB224", className: "-bottom-8 -left-8 size-20 sm:size-28", tilt: -20 },
        { name: "plus", hue: "#E93D82", className: "-top-5 left-12 size-8 sm:size-10", tilt: 20 },
      ]}
    >
      <AutoScheduleScene />
    </LandingSection>
  </Landing>
);

export const FlippedOnLightCanvas = () => (
  <Landing light>
    <LandingSection
      id="focus"
      hue="#30A66D"
      label="Focus and Today"
      step={4}
      headline="One list for today. One thing at a time."
      body="Today shows what is on your calendar, what you chose to focus on and what is still waiting. Start a focus session and Timely counts the real minutes against your estimate."
      flip
      sticker="stopwatch"
      shapes={[
        { name: "ring", hue: "#FFB224", className: "-right-6 -bottom-6 size-16 sm:size-20" },
        { name: "pill", hue: "#0090FF", className: "-top-5 right-12 w-16 sm:w-24", tilt: 10 },
      ]}
    >
      <FocusScene />
    </LandingSection>
  </Landing>
);
