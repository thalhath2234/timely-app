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
      <div className="relative mx-auto grid max-w-[90rem] gap-8 px-4 pt-8 pb-24 sm:px-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12 lg:pt-12">
        <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-2 lg:pb-8">
          <HelpSearch entries={SEARCH_INDEX} size="small" className="relative z-30 mb-4 lg:mb-7" />
          <HelpSidebar sections={SIDEBAR} />
        </aside>
        {children}
      </div>
    </div>
  );
}
