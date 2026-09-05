import Sidebar from "@/app/_components/_layout/sidebar";
import SearchModal from "@/app/_components/_ui/modal/search";
import AddItemModal from "@/app/_components/_ui/modal/addItem";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <SearchModal />
      <AddItemModal />
      <div className="flex flex-row h-full overflow-hidden w-full bg-sidebar">
        <div className="w-16 items-center justify-center h-full bg-sidebar text-sidebar-foreground">
          <Sidebar />
        </div>
        <div className="flex-1 m-1 rounded-lg bg-card text-card-foreground border border-border shadow-sm overflow-hidden">
          {children}
        </div>
      </div>
    </>
  );
}
