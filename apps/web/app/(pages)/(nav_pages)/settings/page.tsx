"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import AccountSettings from "@/app/_components/settings/accountSettings";
import WorkspaceSettings from "@/app/_components/settings/workspaceSettings";
import WorkingHoursSettings from "@/app/_components/settings/workingHoursSettings";
import NotificationSettings from "@/app/_components/settings/notificationSettings";
import ApiKeysSettings from "@/app/_components/settings/apiKeysSettings";
import DataSettings from "@/app/_components/settings/dataSettings";
import { usePreferences } from "@/app/_components/_layout/clientRuntime";
import { cn } from "@/app/utils/cn";

type SettingsTab = "account" | "schedule" | "notifications" | "workspaces" | "data" | "integrations";

const TABS: { id: SettingsTab; label: string; description: string }[] = [
  {
    id: "account",
    label: "Account",
    description: "Your profile and login details",
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
    id: "data",
    label: "Data & appearance",
    description: "Export, backups, restore, and theme",
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
                  "rounded-lg px-3 py-2 text-left transition-colors",
                  active
                    ? "bg-primary/12 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="mt-0.5 block text-[11px] opacity-80">
                  {item.description}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === "account" && <AccountSettings />}
          {tab === "schedule" && <WorkingHoursSettings />}
          {tab === "notifications" && <NotificationSettings />}
          {tab === "workspaces" && <WorkspaceSettings />}
          {tab === "data" && <DataAndAppearance />}
          {tab === "integrations" && <ApiKeysSettings />}
        </div>
      </div>
    </main>
  );
}

function DataAndAppearance() {
  const { theme, setTheme } = usePreferences();
  return (
    <div className="flex flex-col gap-8">
      <section className="max-w-3xl">
        <h2 className="text-base font-semibold">Appearance</h2>
        <p className="mt-1 text-xs text-muted-foreground">Use your device setting or choose a theme for this browser.</p>
        <div className="mt-3 flex gap-2" role="group" aria-label="Color theme">
          {(["system", "light", "dark"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={theme === option} onClick={() => setTheme(option)} className={`rounded-lg border px-3 py-2 text-sm capitalize ${theme === option ? "border-primary/40 bg-primary/12 text-foreground" : "border-border hover:bg-accent"}`}>{option}</button>
          ))}
        </div>
      </section>
      <DataSettings />
    </div>
  );
}
