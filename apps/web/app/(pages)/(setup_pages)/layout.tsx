import { displayFont } from "@/app/_components/site/displayFont";
import { cn } from "@/app/utils/cn";
import "@/app/_components/site/site.css";

// The desktop first-run wizard runs before the app is set up, so it gets no
// sidebar, assistant, search or shortcuts. It shares the sign-up pages' look,
// so the first run reads as one flow.
export default function SetupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={cn("site lp dark", displayFont.variable)}>{children}</div>
  );
}
