import AppShell from "@/app/_components/_layout/appShell";
import SearchModal from "@/app/_components/_ui/modal/search";
import AddItemModal from "@/app/_components/_ui/modal/addItem";
import AutoScheduleIndicator from "@/app/_components/calendarView/autoScheduleIndicator";
import ToastHost from "@/app/_components/_ui/toastHost";
import ContextMenuHost from "@/app/_components/_ui/contextMenu";
import ConfirmHost from "@/app/_components/_ui/confirmHost";
import EntityDetailHost from "@/app/_components/_ui/tasks/entityDetailHost";
import PageTabLinks from "@/app/_components/pageTabs/pageTabLinks";
import SetupResume from "@/app/_components/_layout/setupResume";

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
      <PageTabLinks />
      <SetupResume />
      <AutoScheduleIndicator />
      <ToastHost />
      <ContextMenuHost />
      <ConfirmHost />
      <AppShell>{children}</AppShell>
    </>
  );
}
