import SheetList from "@/app/_components/sheets/sheetList";

export default function SheetsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <SheetList />
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
