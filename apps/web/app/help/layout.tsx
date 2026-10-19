import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteMotion } from "@/app/_components/site/motion";
import { siteFont } from "@/app/_components/site/siteFont";
import SiteFooter from "@/app/_components/site/siteFooter";
import SiteHeader from "@/app/_components/site/siteHeader";
import { cn } from "@/app/utils/cn";
import "@/app/_components/site/site.css";

export const metadata: Metadata = {
  title: { default: "Timely Help", template: "%s · Timely Help" },
  description:
    "Install Timely on Windows, Ubuntu, Arch Linux and Android, pair your phone, connect your AI, and learn everything it can do: Inbox, Auto-schedule, tasks, docs, sheets, smart suggestions, the assistant and agents over MCP.",
};

export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <div className={cn("site", siteFont.variable)}>
      <SiteMotion>
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </SiteMotion>
    </div>
  );
}
