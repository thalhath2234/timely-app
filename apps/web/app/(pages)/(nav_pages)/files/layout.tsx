import FileList from "@/app/_components/files/fileList";
import TabbedPane from "@/app/_components/pageTabs/tabbedPane";

export default function FilesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <FileList />
      <TabbedPane>{children}</TabbedPane>
    </div>
  );
}
