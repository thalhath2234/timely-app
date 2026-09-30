"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import AccountSettings from "@/app/_components/settings/accountSettings";
import WorkspaceSettings from "@/app/_components/settings/workspaceSettings";
import WorkingHoursSettings from "@/app/_components/settings/workingHoursSettings";
import NotificationSettings from "@/app/_components/settings/notificationSettings";
import ApiKeysSettings from "@/app/_components/settings/apiKeysSettings";
import AgentSettings from "@/app/_components/settings/agentSettings";
import DataSettings from "@/app/_components/settings/dataSettings";
import AppearanceSettings from "@/app/_components/settings/appearanceSettings";
import { cn } from "@/app/utils/cn";
import { AnimatePresence, motion } from "motion/react";
import { fadeTransition, springSoft } from "@/app/_components/_ui/motion";

type SettingsTab = "account" | "appearance" | "schedule" | "notifications" | "workspaces" | "agent" | "data" | "integrations";

const TABS: { id: SettingsTab; label: string; description: string }[] = [
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

function isTab(value: string | null): value is SettingsTab {
  return TABS.some((tab) => tab.id === value);
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-5 text-muted-foreground">Loading settings...</div>}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<SettingsTab>(isTab(initialTab) ? initialTab : "account");

  return (
    <main className="flex h-full flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-6 py-5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account and per-workspace configuration.
        </p>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-border bg-background p-3">
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-lg px-3 py-2 text-left transition-colors",
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
                <span className="relative z-10 mt-0.5 block text-[11px] opacity-80">
                  {item.description}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={fadeTransition}
            >
              {tab === "account" && <AccountSettings />}
              {tab === "appearance" && <AppearanceSettings />}
              {tab === "schedule" && <WorkingHoursSettings />}
              {tab === "notifications" && <NotificationSettings />}
              {tab === "workspaces" && <WorkspaceSettings />}
              {tab === "agent" && <AgentSettings />}
              {tab === "data" && <DataSettings />}
              {tab === "integrations" && <ApiKeysSettings />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
