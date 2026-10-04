import { AccountSettings } from "@timely/ui";
import { useEffect, useRef } from "react";

const TABS = [
  ["account", "Account", "Your profile and login details"],
  ["appearance", "Appearance", "Theme, colors, and sidebar"],
  ["schedule", "Schedule", "Working hours, freeze, and engine controls"],
  ["notifications", "Notifications", "Reminders, digests, quiet hours, and jobs"],
  ["workspaces", "Workspaces", "Statuses, labels, and custom fields"],
  ["agent", "Agent", "AI provider and default model"],
  ["data", "Data & privacy", "Export, backups, and restore"],
  ["integrations", "Integrations", "API keys for Hermes and MCP"],
] as const;

/** The Settings page chrome (header, tab rail, scrolling content pane) around one section, at a small-laptop window size. */
function SettingsPage({ tab, scrollTo, children }: { tab: (typeof TABS)[number][0]; scrollTo?: string; children: React.ReactNode }) {
  const paneRef = useRef<HTMLDivElement>(null);
  // Scrolls the content pane so the heading with this text sits at the top (waits for data to load).
  useEffect(() => {
    if (!scrollTo) return;
    let tries = 0;
    const id = setInterval(() => {
      const pane = paneRef.current;
      const heading = Array.from(pane?.querySelectorAll("h2, h3") ?? []).find((h) => h.textContent?.trim() === scrollTo);
      if (pane && heading) pane.scrollTop = heading.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 24;
      if (heading || ++tries > 60) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [scrollTo]);
  return (
    <main className="flex flex-col overflow-hidden bg-background" style={{ width: 880, height: 680 }}>
      <div className="border-b border-border px-6 py-5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account and per-workspace configuration.</p>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-border bg-background p-3">
          {TABS.map(([id, label, description]) => (
            <button
              key={id}
              type="button"
              aria-current={id === tab ? "page" : undefined}
              className={`relative rounded-lg px-3 py-2 text-left transition-colors ${id === tab ? "text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
            >
              {id === tab ? <span className="absolute inset-0 rounded-lg bg-primary/12" /> : null}
              <span className="relative z-10 block text-sm font-medium">{label}</span>
              <span className="relative z-10 mt-0.5 block text-[11px] opacity-80">{description}</span>
            </button>
          ))}
        </nav>
        <div ref={paneRef} className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </main>
  );
}

/** The content pane alone, at roughly the width it gets inside Settings. */
const Pane = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-background p-6" style={{ width: 860 }}>{children}</div>
);

export const InSettings = () => (
  <SettingsPage tab="account">
    <AccountSettings />
  </SettingsPage>
);



export const Devices = () => (
  <SettingsPage tab="account" scrollTo="Devices">
    <AccountSettings />
  </SettingsPage>
);
