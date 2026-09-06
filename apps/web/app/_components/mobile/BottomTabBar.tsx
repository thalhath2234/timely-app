"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  FileText,
  ListTodo,
  Menu,
  Sheet as SheetIcon,
  type LucideIcon,
} from "lucide-react";

const TABS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Calendar", href: "/m/calendar", icon: Calendar },
  { label: "Tasks", href: "/m/tasks", icon: ListTodo },
  { label: "Docs", href: "/m/docs", icon: FileText },
  { label: "Sheets", href: "/m/sheets", icon: SheetIcon },
  { label: "More", href: "/m/more", icon: Menu },
];

export default function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="shrink-0 border-t border-border bg-sidebar/95 backdrop-blur pb-safe"
    >
      <ul className="flex h-16 items-stretch">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground active:text-foreground"
                }`}
              >
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                    active ? "bg-accent" : ""
                  }`}
                >
                  <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
