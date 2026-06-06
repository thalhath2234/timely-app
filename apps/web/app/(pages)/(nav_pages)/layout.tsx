import Sidebar from "@/app/_components/_layout/sidebar";
import SearchModal from "@/app/_ui/modal/search";
import AddItemModal from "@/app/_ui/modal/addItem";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <SearchModal />
      <AddItemModal/>
      <div className="flex flex-row h-full overflow-hidden w-full">
        <div className="w-16 items-center justify-center h-full">
          <Sidebar />
        </div>
        <div className="flex-1 m-1 rounded-md bg-secondary backdrop-blur border border-white/30 shadow-lg overflow-hidden">
          {children}
        </div>
      </div>
    </>
  );
}
