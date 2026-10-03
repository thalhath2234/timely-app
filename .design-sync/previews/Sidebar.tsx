import { Sidebar } from "@timely/ui";
import { useEffect, useRef } from "react";

// usePathname is shimmed to window.__TIMELY_PATHNAME__; each cell sets it before
// its Sidebar renders so the right nav item is active.
const at = (path: string) => {
  (window as any).__TIMELY_PATHNAME__ = path;
};
at("/today");

const Rail = ({ children, railRef }: { children: React.ReactNode; railRef?: React.Ref<HTMLDivElement> }) => (
  <div className="flex bg-background" style={{ width: 220, height: 620 }}>
    <div
      ref={railRef}
      className="flex h-full items-center justify-center border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      style={{ width: 68 }}
    >
      {children}
    </div>
  </div>
);

export const TodayActive = () => {
  at("/today");
  return (
    <Rail>
      <Sidebar />
    </Rail>
  );
};

export const DocsActive = () => {
  at("/docs/doc_weekly_notes");
  return (
    <Rail>
      <Sidebar />
    </Rail>
  );
};

export const AddMenuOpen = () => {
  at("/tasks");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[aria-label="Add item"]')?.click();
  }, []);
  return (
    <Rail railRef={ref}>
      <Sidebar />
    </Rail>
  );
};
