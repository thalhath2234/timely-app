import type { ReactNode } from "react";
import HelpSearch from "@/app/_components/help/helpSearch";
import HelpSidebar, { type SidebarSection } from "@/app/_components/help/helpSidebar";
import { HELP_SECTIONS, SEARCH_INDEX, articleHref } from "@/app/_components/help/registry";

const SIDEBAR: SidebarSection[] = HELP_SECTIONS.map((section) => ({
  id: section.id,
  title: section.title,
  articles: section.articles.map((article) => ({ href: articleHref(section, article), title: article.title })),
}));

/**
 * Shared by every article, so the sidebar (and its scroll position) stays put
 * while you move between articles; only the article column changes.
 */
export default function HelpArticlesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-16 h-[420px] overflow-hidden">
        <div className="s-orb top-[-60%] left-[30%] size-[460px] bg-[#6f6ff0] opacity-25" />
      </div>

      <div className="relative mx-auto grid max-w-7xl gap-8 px-4 pt-8 pb-24 sm:px-8 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-10 lg:pt-12">
        <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-2 lg:pb-8">
          <HelpSearch entries={SEARCH_INDEX} size="small" className="relative z-30 mb-4 lg:mb-7" />
          <HelpSidebar sections={SIDEBAR} />
        </aside>
        {children}
      </div>
    </div>
  );
}
