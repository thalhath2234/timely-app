import { MiniWindow, SceneBox, SceneButton } from "@timely/ui";
import { Check, Sparkles, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

const Landing = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing l-hue p-8" style={{ width: 480, "--hue": "#6E56CF" } as CSSProperties}>
        <div className="l-stage rounded-[1.75rem] p-4">
          <SceneBox height={110} eager interactive label="Scene buttons.">
            <div className="absolute inset-0">
              <MiniWindow title="Auto-schedule" className="h-full">
                <div className="flex h-full items-center justify-center gap-3 p-3">{children}</div>
              </MiniWindow>
            </div>
          </SceneBox>
        </div>
      </div>
    </div>
  </div>
);

const noop = () => {};

export const Variants = () => (
  <Landing>
    <SceneButton onClick={noop}>
      <X className="size-3" />
      Cancel
    </SceneButton>
    <SceneButton primary onClick={noop}>
      <Check className="size-3" />
      Apply changes
    </SceneButton>
  </Landing>
);

export const PrimaryPulse = () => (
  <Landing>
    <SceneButton primary pulse onClick={noop}>
      <Sparkles className="size-3" />
      Auto-schedule
    </SceneButton>
  </Landing>
);

export const Disabled = () => (
  <Landing light>
    <SceneButton primary disabled onClick={noop}>
      <Sparkles className="size-3" />
      Auto-schedule
    </SceneButton>
    <SceneButton disabled onClick={noop}>
      Discard
    </SceneButton>
  </Landing>
);
