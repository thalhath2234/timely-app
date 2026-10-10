// The desktop first-run wizard runs before the app is set up, so it gets no
// sidebar, assistant, search or shortcuts.
export default function SetupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="h-screen w-full overflow-y-auto bg-background">{children}</div>;
}
