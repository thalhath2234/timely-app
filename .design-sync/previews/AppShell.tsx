import { AppShell, DocList, EmptyState, TodayDashboard } from "@timely/ui";
import { FileText } from "lucide-react";

// usePathname is shimmed to window.__TIMELY_PATHNAME__; each cell sets it
// before the shell renders so the sidebar highlights the right page.
const at = (path: string) => {
  (window as any).__TIMELY_PATHNAME__ = path;
};
at("/today");

const Window = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 1280, height: 800 }}>{children}</div>
);

export const TodayPage = () => {
  at("/today");
  return (
    <Window>
      <AppShell>
        <TodayDashboard />
      </AppShell>
    </Window>
  );
};

export const DocsPage = () => {
  at("/docs");
  return (
    <Window>
      <AppShell>
        <div className="flex h-full w-full overflow-hidden">
          <DocList />
          <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden p-8">
            <EmptyState
              icon={FileText}
              title="Pick a doc"
              description="Choose a page on the left, or start a new one for this week's notes."
            />
          </div>
        </div>
      </AppShell>
    </Window>
  );
};
