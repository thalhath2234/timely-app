import type { Metadata, Viewport } from "next";
import MobileShell from "@/app/_components/mobile/MobileShell";

export const metadata: Metadata = {
  title: "Timely – Mobile",
  description: "Phone-sized prototype of Timely: calendar, tasks, docs and sheets.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1a1b22",
};

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <MobileShell>{children}</MobileShell>;
}
