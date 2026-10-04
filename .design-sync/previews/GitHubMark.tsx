import { GitHubMark } from "@timely/ui";
import type { CSSProperties, ReactNode } from "react";

const Landing = ({ children, light = false }: { children: ReactNode; light?: boolean }) => (
  <div data-landing-theme={light ? "light" : undefined}>
    <div className="landing">
      <div
        className="landing l-hue flex flex-wrap items-center gap-6 p-8"
        style={{ width: 560, "--hue": "#6E56CF" } as CSSProperties}
      >
        {children}
      </div>
    </div>
  </div>
);

export const GetTheCodeButton = () => (
  <Landing>
    <a
      href="#get-the-code"
      className="l-button inline-flex h-12 items-center gap-2.5 rounded-full px-6 text-base font-semibold"
    >
      <GitHubMark className="size-5" />
      Get the code
    </a>
    <a href="#footer" className="l-soft inline-flex items-center gap-2 text-sm font-medium">
      <GitHubMark className="size-4" />
      thalhath2234/timely-app
    </a>
  </Landing>
);

export const Sizes = () => (
  <Landing light>
    <GitHubMark className="size-4" />
    <GitHubMark className="size-5" />
    <GitHubMark className="size-8" />
    <span className="l-soft text-sm">16, 20 and 32 px, inheriting the text colour</span>
  </Landing>
);
