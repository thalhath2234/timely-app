import DocList from "@/app/_components/docs/docList";

export default function DocsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <DocList />
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
