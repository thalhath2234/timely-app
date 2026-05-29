import Sidebar from "../_components/_layout/sidebar";
import SearchModal from "../_ui/modal/search";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <SearchModal />
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
