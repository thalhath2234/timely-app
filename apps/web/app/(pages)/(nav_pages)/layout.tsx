import Sidebar from "@/app/_components/_layout/sidebar";
import SearchModal from "@/app/_components/_ui/modal/search";
import AddItemModal from "@/app/_components/_ui/modal/addItem";
import AutoScheduleIndicator from "@/app/_components/calendarView/autoScheduleIndicator";
import ToastHost from "@/app/_components/_ui/toastHost";
import KeyboardShortcuts from "@/app/_components/_ui/keyboardShortcuts";
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
      <AutoScheduleIndicator />
      <Suspense fallback={null}>
        <KeyboardShortcuts />
      </Suspense>
      <ToastHost />
      <div className="flex flex-row h-full overflow-hidden w-full bg-sidebar">
        <div className="w-16 items-center justify-center h-full bg-sidebar text-sidebar-foreground">
          <Sidebar />
        </div>
        <div id="main-content" className="flex-1 m-1 rounded-lg bg-card text-card-foreground border border-border shadow-sm overflow-hidden">
          {children}
        </div>
      </div>
    </>
  );
}
