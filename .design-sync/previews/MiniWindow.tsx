import { MiniWindow, SceneBox } from "@timely/ui";
import { Inbox, Search } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

const Landing = ({
  children,
  light = false,
  hue = "#FFB224",
}: {
  children: ReactNode;
  light?: boolean;
  hue?: string;
}) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div className="landing l-hue p-8" style={{ width: 480, "--hue": hue } as CSSProperties}>
        <div className="l-stage rounded-[1.75rem] p-4">
          <SceneBox height={200} eager label="A miniature app window.">
            <div className="absolute inset-0">{children}</div>
          </SceneBox>
        </div>
      </div>
    </div>
  </div>
);

const InboxRows = () => (
  <div className="space-y-1.5 p-3">
    {["Draft onboarding flow", "Call the landlord about the lease", "Send invoice #1042"].map((title) => (
      <div
        key={title}
        className="mini-11 flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
      >
        <Inbox className="size-3 text-muted-foreground" />
        {title}
      </div>
    ))}
  </div>
);

export const InboxWindow = () => (
  <Landing>
    <MiniWindow title="Inbox" className="h-full">
      <InboxRows />
    </MiniWindow>
  </Landing>
);

export const WithRightSlot = () => (
  <Landing hue="#F76808">
    <MiniWindow
      title="Website refresh · Studio"
      className="h-full"
      right={
        <span className="mini-9 flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-medium text-muted-foreground">
          <Search className="size-2.5" />
          Ctrl K
        </span>
      }
    >
      <InboxRows />
    </MiniWindow>
  </Landing>
);

export const OnLightCanvas = () => (
  <Landing light>
    <MiniWindow title="Inbox" className="h-full">
      <InboxRows />
    </MiniWindow>
  </Landing>
);
