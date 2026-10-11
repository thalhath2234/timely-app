import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteMotion } from "@/app/_components/site/motion";
import SiteFooter from "@/app/_components/site/siteFooter";
import SiteHeader from "@/app/_components/site/siteHeader";
import "@/app/_components/site/site.css";

export const metadata: Metadata = {
  title: { default: "Timely Help Center", template: "%s · Timely Help" },
  description:
    "Install Timely on Windows, Ubuntu, Arch Linux and Android, and learn everything it can do: Inbox, Auto-schedule, tasks, docs, sheets, the assistant and more.",
};

export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site">
      <SiteMotion>
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </SiteMotion>
    </div>
  );
}
