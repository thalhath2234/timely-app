import { Caret, MiniWindow, SceneBox, Typed } from "@timely/ui";
import type { CSSProperties, ReactNode } from "react";

const Landing = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing l-hue p-8" style={{ width: 480, "--hue": "#FFB224" } as CSSProperties}>
        <div className="l-stage rounded-[1.75rem] p-4">
          <SceneBox height={110} eager label="A line typed into the Inbox.">
            <div className="absolute inset-0">
              <MiniWindow title="Inbox" className="h-full">
                <div className="p-3">
                  <div className="mini-12 rounded-md border border-border bg-card px-2.5 py-2">{children}</div>
                </div>
              </MiniWindow>
            </div>
          </SceneBox>
        </div>
      </div>
    </div>
  </div>
);

export const Finished = () => (
  <Landing>
    <Typed text="Draft onboarding flow" done />
  </Landing>
);

export const WithCaret = () => (
  <Landing>
    <Typed text="Call the landlord about the lease" done />
    <Caret />
  </Landing>
);

export const OnLightCanvas = () => (
  <Landing light>
    <Typed text="Send invoice #1042" done />
    <Caret />
  </Landing>
);
