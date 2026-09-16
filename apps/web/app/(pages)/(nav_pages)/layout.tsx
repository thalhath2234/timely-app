import Sidebar from "@/app/_components/_layout/sidebar";
import SearchModal from "@/app/_components/_ui/modal/search";
import AddItemModal from "@/app/_components/_ui/modal/addItem";
import AutoScheduleIndicator from "@/app/_components/calendarView/autoScheduleIndicator";
import ToastHost from "@/app/_components/_ui/toastHost";
import KeyboardShortcuts from "@/app/_components/_ui/keyboardShortcuts";
import EntityDetailHost from "@/app/_components/_ui/tasks/entityDetailHost";
import { Suspense } from "react";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <SearchModal />
      <AddItemModal />
      <EntityDetailHost />
      <AutoScheduleIndicator />
      <Suspense fallback={null}>
        <KeyboardShortcuts />
      </Suspense>
      <ToastHost />
      <div className="flex h-full w-full flex-row overflow-hidden bg-sidebar">
        <div className="flex h-full w-[68px] shrink-0 items-center justify-center border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
          <Sidebar />
        </div>
        <div id="main-content" className="m-1 flex-1 overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-sm">
          {children}
        </div>
      </div>
    </>
  );
}
