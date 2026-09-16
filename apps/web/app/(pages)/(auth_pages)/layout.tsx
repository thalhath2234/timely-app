export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark min-h-screen bg-[#0c0e14] text-[#e2e2eb]">{children}</div>
  );
}
