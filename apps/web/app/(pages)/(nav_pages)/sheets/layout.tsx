import SheetList from "@/app/_components/sheets/sheetList";
import TabbedPane from "@/app/_components/pageTabs/tabbedPane";

export default function SheetsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <SheetList />
      <TabbedPane>{children}</TabbedPane>
    </div>
  );
}
