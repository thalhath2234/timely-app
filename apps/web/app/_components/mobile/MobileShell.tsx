"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import BottomTabBar from "./BottomTabBar";
import { SHEET_PORTAL_ID } from "./BottomSheet";
import QuickAddSheet from "./QuickAddSheet";
import AutoScheduleIndicator from "@/app/_components/calendarView/autoScheduleIndicator";

const TAB_ROOTS = ["/m/calendar", "/m/tasks", "/m/docs", "/m/sheets"];

/**
 * Phone frame. Full-bleed on real phones, a centered 430px device mockup on
 * wider screens so the prototype reads as a mobile app in the desktop preview.
 */
export default function MobileShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [addOpen, setAddOpen] = useState(false);

  const showFab = TAB_ROOTS.includes(pathname);
  const showTabs = !pathname.match(/^\/m\/(tasks|docs|sheets)\/[^/]+$/);

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-sidebar sm:p-6">
      <div
        id={SHEET_PORTAL_ID}
        className="relative flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-background text-foreground sm:h-[min(100%,900px)] sm:rounded-[2.5rem] sm:border sm:border-border sm:shadow-2xl sm:ring-8 sm:ring-sidebar-accent/60"
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          {children}
          {showFab ? (
            <button
              type="button"
              aria-label="Add"
              onClick={() => setAddOpen(true)}
              className="absolute right-4 bottom-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-95"
            >
              <Plus size={26} />
            </button>
          ) : null}
        </div>
        {showTabs ? <BottomTabBar /> : null}
        <QuickAddSheet open={addOpen} onClose={() => setAddOpen(false)} />
        <AutoScheduleIndicator className="absolute bottom-24 right-3" />
      </div>
    </div>
  );
}
