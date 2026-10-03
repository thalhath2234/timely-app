import { SearchModal } from "@timely/ui";
import { useEffect } from "react";

// The palette is opened by the app's own Ctrl/⌘+K listener; its overlay is
// position:fixed (not portaled), so the transformed frame is its containing block.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: "calc(100vw - 48px)", height: "calc(100vh - 48px)", transform: "translateZ(0)" }}>{children}</div>
);

function typeInto(input: HTMLInputElement | null, value: string) {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Opens the palette with Ctrl+K, then optionally types a query and picks a tab. */
function Palette({ query, tab, demo }: { query?: string; tab?: string; demo?: boolean }) {
  useEffect(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true }));
    const timer = window.setTimeout(() => {
      if (tab) document.getElementById(`palette-tab-${tab}`)?.click();
      if (query) typeInto(document.querySelector<HTMLInputElement>('input[role="combobox"]'), query);
    }, 30);
    return () => {
      window.clearTimeout(timer);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    };
  }, [query, tab]);
  return (
    <Frame>
      <SearchModal {...(demo ? { demoItems: DEMO, onDemoSelect: () => undefined } : {})} />
    </Frame>
  );
}

const DEMO = [
  { id: "roadmap", kind: "sheet", title: "Product roadmap", snippet: "Planning · Milestones, priorities, and what’s next" },
  { id: "brief", kind: "doc", title: "Website launch brief", snippet: "Notes · A clear plan for launch day" },
  { id: "review", kind: "task", title: "Review the launch checklist", snippet: "Website refresh · In progress" },
  { id: "budget", kind: "sheet", title: "Launch budget", snippet: "Planning · Track estimates and actual costs" },
  { id: "design", kind: "project", title: "Website refresh", snippet: "Projects · Design, build, and launch" },
  { id: "planning", kind: "event", title: "Weekly planning", snippet: "Calendar · Make room for what matters" },
] as const;

export const QuickActions = () => <Palette />;

export const SearchResults = () => <Palette query="onboarding" />;

export const TasksTab = () => <Palette query="tokens" tab="task" />;

export const NoMatches = () => <Palette query="quarterly tax filing" />;

export const DemoSamples = () => <Palette demo />;
