import { CountUp, MiniWindow, SceneBox } from "@timely/ui";
import type { CSSProperties, ReactNode } from "react";

const clock = (seconds: number) => {
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const percent = (value: number) => `${Math.round(value)}%`;

const Landing = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing l-hue p-8" style={{ width: 480, "--hue": "#30A66D" } as CSSProperties}>
        <div className="l-stage rounded-[1.75rem] p-4">
          <SceneBox height={120} eager label="A focus session timer.">
            <div className="absolute inset-0">
              <MiniWindow title="Focus · Draft onboarding flow" className="h-full">
                <div className="flex h-full items-center p-3" style={{ justifyContent: "space-around" }}>
                  {children}
                </div>
              </MiniWindow>
            </div>
          </SceneBox>
        </div>
      </div>
    </div>
  </div>
);

const Stat = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="text-center">
    <div className="mini-26 font-mono font-semibold">{children}</div>
    <div className="mini-10 text-muted-foreground">{label}</div>
  </div>
);

export const Active = () => (
  <Landing>
    <Stat label="Focused">
      <CountUp value={1680} active format={clock} duration={0} />
    </Stat>
    <Stat label="Of estimate">
      <CountUp value={93} active format={percent} duration={0} />
    </Stat>
  </Landing>
);

export const NotStarted = () => (
  <Landing light>
    <Stat label="Focused">
      <CountUp value={1680} active={false} format={clock} />
    </Stat>
    <Stat label="Of estimate">
      <CountUp value={93} active={false} format={percent} />
    </Stat>
  </Landing>
);
