"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import AccountSettings from "@/app/_components/settings/accountSettings";
import WorkspaceSettings from "@/app/_components/settings/workspaceSettings";
import WorkingHoursSettings from "@/app/_components/settings/workingHoursSettings";
import NotificationSettings from "@/app/_components/settings/notificationSettings";
import ApiKeysSettings from "@/app/_components/settings/apiKeysSettings";
import AgentSettings from "@/app/_components/settings/agentSettings";
import DataSettings from "@/app/_components/settings/dataSettings";
import AppearanceSettings from "@/app/_components/settings/appearanceSettings";
import ServerSettings from "@/app/_components/settings/serverSettings";
import { useDesktopBridge } from "@/app/utils/hooks/desktop";
import { cn } from "@/app/utils/cn";
import PageHeader from "@/app/_components/_ui/pageHeader";
import PageWithRail from "@/app/_components/_ui/pageWithRail";
import AppearancePreview from "@/app/_components/settings/appearancePreview";
import WorkspaceUsage from "@/app/_components/settings/workspaceUsage";
import { AnimatePresence, motion } from "motion/react";
import { fadeTransition, springSoft } from "@/app/_components/_ui/motion";

type SettingsTab =
  | "account"
  | "appearance"
  | "schedule"
  | "notifications"
  | "workspaces"
  | "agent"
  | "data"
  | "integrations"
  | "server";

type TabItem = { id: SettingsTab; label: string; description: string };

const TABS: TabItem[] = [
  {
    id: "account",
    label: "Account",
    description: "Your profile and login details",
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, colors, and sidebar",
  },
  {
    id: "schedule",
    label: "Schedule",
    description: "Working hours, freeze, and engine controls",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Reminders, digests, quiet hours, and jobs",
  },
  {
    id: "workspaces",
    label: "Workspaces",
    description: "Statuses, labels, and custom fields",
  },
  {
    id: "agent",
    label: "Agent",
    description: "AI provider and default model",
  },
  {
    id: "data",
    label: "Data & privacy",
    description: "Export, backups, and restore",
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "API keys for Hermes and MCP",
  },
];

// Only the desktop app hosts its own server; the tab is appended after mount
// so the list never flashes in a browser.
const SERVER_TAB: TabItem = {
  id: "server",
  label: "Server",
  description: "Address, pairing, and status",
};

function isTab(value: string | null): value is SettingsTab {
  return value === SERVER_TAB.id || TABS.some((tab) => tab.id === value);
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-5 text-muted-foreground">Loading settings...</div>}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const requested = useSearchParams().get("tab");
  const initialTab = isTab(requested) ? requested : "account";
  // Remount when ?tab= changes so links into an open Settings page switch tabs.
  return <SettingsTabs key={initialTab} initialTab={initialTab} />;
}

function SettingsTabs({ initialTab }: { initialTab: SettingsTab }) {
  const [requestedTab, setTab] = useState<SettingsTab>(initialTab);
  // The workspace open under Workspaces, shared with its rail.
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const desktop = useDesktopBridge();
  const tabs = desktop ? [...TABS, SERVER_TAB] : TABS;
  // ?tab=server outside the desktop app falls back to the first tab instead of
  // rendering a panel that has no entry in the list.
  const tab: SettingsTab = requestedTab === "server" && !desktop ? "account" : requestedTab;
  // Appearance shows itself; Workspaces shows what the open workspace's
  // statuses, labels and fields are used by. Other tabs lay out in two columns.
  const rail = tab === "appearance" ? <AppearancePreview /> : tab === "workspaces" ? <WorkspaceUsage workspaceId={workspaceId} /> : null;
  // In the narrow strip, keep the open section's entry in view.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const strip = nav.current;
    const active = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft += active.getBoundingClientRect().left - strip.getBoundingClientRect().left - 8;
  }, [tab]);

  return (
    <main className="flex h-full flex-col overflow-hidden bg-background">
      <PageHeader
        bordered
        title="Settings"
      />

      {/* On a narrow screen the section list becomes a scrolling strip above
          the section, so the section keeps the full width. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav ref={nav} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-background p-2 md:w-52 md:flex-col md:overflow-x-visible md:border-r md:border-b-0 md:p-3">
          {tabs.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative shrink-0 rounded-lg px-3 py-2 text-left whitespace-nowrap transition-colors md:whitespace-normal",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="settings-tab-pill"
                    transition={springSoft}
                    className="absolute inset-0 rounded-lg bg-primary/12"
                  />
                ) : null}
                <span className="relative z-10 block text-sm font-medium">{item.label}</span>
                <span className="relative z-10 mt-0.5 hidden text-[11px] opacity-80 md:block">
                  {item.description}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={fadeTransition}
            >
              <PageWithRail rail={rail} railWidth={340}>
                {tab === "account" && <AccountSettings />}
                {tab === "appearance" && <AppearanceSettings />}
                {tab === "schedule" && <WorkingHoursSettings />}
                {tab === "notifications" && <NotificationSettings />}
                {tab === "workspaces" && <WorkspaceSettings selectedId={workspaceId} onSelect={setWorkspaceId} />}
                {tab === "agent" && <AgentSettings />}
                {tab === "data" && <DataSettings />}
                {tab === "integrations" && <ApiKeysSettings />}
                {tab === "server" && <ServerSettings />}
              </PageWithRail>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
