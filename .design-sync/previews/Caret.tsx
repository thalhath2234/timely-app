import { Caret, MiniWindow, SceneBox } from "@timely/ui";
import { Search } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

const Landing = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing l-hue p-8" style={{ width: 480, "--hue": "#F76808" } as CSSProperties}>
        <div className="l-stage rounded-[1.75rem] p-4">
          <SceneBox height={90} eager label="A text field with a blinking caret.">
            <div className="absolute inset-0">
              <MiniWindow title="Search" className="h-full">
                <div className="p-3">{children}</div>
              </MiniWindow>
            </div>
          </SceneBox>
        </div>
      </div>
    </div>
  </div>
);

export const AfterText = () => (
  <Landing>
    <div className="mini-12 flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2">
      <Search className="size-3 text-muted-foreground" />
      <span>
        launch bud
        <Caret />
      </span>
    </div>
  </Landing>
);

export const EmptyField = () => (
  <Landing light>
    <div className="mini-12 flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2">
      <Search className="size-3 text-muted-foreground" />
      <span>
        <Caret />
      </span>
    </div>
  </Landing>
);
