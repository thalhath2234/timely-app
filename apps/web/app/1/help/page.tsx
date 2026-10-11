import type { Metadata } from "next";
import HelpHomeOne from "@/app/_components/help/helpHomeOne";
import { SiteMotion } from "@/app/_components/site/motion";
import SiteFooter from "@/app/_components/site/siteFooter";
import SiteHeader from "@/app/_components/site/siteHeader";
import "@/app/_components/site/site.css";

export const metadata: Metadata = { title: { absolute: "Timely Help Center · Design 1" } };

/** Design iteration 1: the current help center home. Articles stay at /help/<section>/<article>. */
export default function DesignOneHelp() {
  return (
    <div className="site">
      <SiteMotion>
        <SiteHeader base="/1" />
        <main id="main-content">
          <HelpHomeOne />
        </main>
        <SiteFooter />
      </SiteMotion>
    </div>
  );
}
