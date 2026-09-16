import AppShell from "@/app/_components/_layout/appShell";
import SearchModal from "@/app/_components/_ui/modal/search";
import AddItemModal from "@/app/_components/_ui/modal/addItem";
import AutoScheduleIndicator from "@/app/_components/calendarView/autoScheduleIndicator";
import ToastHost from "@/app/_components/_ui/toastHost";
import ContextMenuHost from "@/app/_components/_ui/contextMenu";
import ConfirmHost from "@/app/_components/_ui/confirmHost";
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
      <ContextMenuHost />
      <ConfirmHost />
      <AppShell>{children}</AppShell>
    </>
  );
}
