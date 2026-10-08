import DocList from "@/app/_components/docs/docList";
import TabbedPane from "@/app/_components/pageTabs/tabbedPane";

export default function DocsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <DocList />
      <TabbedPane>{children}</TabbedPane>
    </div>
  );
}
