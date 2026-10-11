import HelpHome, { helpHomeMetadata } from "@/app/_components/help/helpHome";
import { SiteMotion } from "@/app/_components/site/motion";
import SiteFooter from "@/app/_components/site/siteFooter";
import SiteHeader from "@/app/_components/site/siteHeader";
import "@/app/_components/site/site.css";

export const metadata = helpHomeMetadata;

/** The current help center front page under design 1; articles stay at /help/<section>/<slug>. */
export default function DesignOneHelp() {
  return (
    <div className="site">
      <SiteMotion>
        <SiteHeader base="/1" />
        <main id="main-content">
          <HelpHome />
        </main>
        <SiteFooter base="/1" />
      </SiteMotion>
    </div>
  );
}
