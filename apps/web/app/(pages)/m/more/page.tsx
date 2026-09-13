"use client";

import {
  Brain,
  Clock,
  KeyRound,
  Monitor,
  Settings,
  Tag,
  type LucideIcon,
} from "lucide-react";
import MobileHeader from "@/app/_components/mobile/MobileHeader";
import ListCard, { SectionLabel } from "@/app/_components/mobile/ListCard";
import { useMobileUser, useMobileWorkspaces } from "@/app/_lib/mobile/useMobileData";

function RowIcon({ icon: Icon, tone = "muted" }: { icon: LucideIcon; tone?: "muted" | "primary" }) {
  return (
    <span
      className={`flex h-9 w-9 items-center justify-center rounded-lg ${
        tone === "primary" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"
      }`}
    >
      <Icon size={18} />
    </span>
  );
}

export default function MorePage() {
  const { data: user, isDemo } = useMobileUser();
  const { data: workspaces } = useMobileWorkspaces();
  const account = user ?? { name: "", email: "" };
  const initials = (account.name || account.email || "T")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <MobileHeader title="More" isDemo={isDemo} />
      <main className="min-h-0 flex-1 overflow-y-auto px-3 pb-24">
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-primary-foreground">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-card-foreground">
              {account.name || "Your account"}
            </p>
            <p className="truncate text-xs text-muted-foreground">{account.email}</p>
          </div>
        </div>

        <SectionLabel>Workspaces</SectionLabel>
        <div className="flex flex-col gap-2">
          {workspaces.map((w) => (
            <ListCard
              key={w.id}
              href="/m/tasks"
              leading={<RowIcon icon={Tag} tone="primary" />}
              title={w.name}
              meta={
                <span>
                  {w.status.length} statuses · {(w.lables ?? []).length} labels
                </span>
              }
            />
          ))}
        </div>

        <SectionLabel>Tools</SectionLabel>
        <div className="flex flex-col gap-2">
          <ListCard
            href="/report"
            leading={<RowIcon icon={Brain} />}
            title="Report"
            meta={<span>Weekly summary and focus time</span>}
          />
          <ListCard
            href="/settings"
            leading={<RowIcon icon={Clock} />}
            title="Working hours"
            meta={<span>When the scheduler can place tasks</span>}
          />
          <ListCard
            href="/settings"
            leading={<RowIcon icon={KeyRound} />}
            title="API keys"
            meta={<span>Connect scripts and automations</span>}
          />
          <ListCard
            href="/settings"
            leading={<RowIcon icon={Settings} />}
            title="Settings"
            meta={<span>Statuses, labels, custom fields</span>}
          />
        </div>

        <SectionLabel>App</SectionLabel>
        <div className="flex flex-col gap-2">
          <ListCard
            href="/calendar"
            leading={<RowIcon icon={Monitor} />}
            title="Switch to desktop app"
            meta={<span>Kanban, Gantt and full editing</span>}
          />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Timely mobile prototype · reference for the native app
        </p>
      </main>
    </>
  );
}
