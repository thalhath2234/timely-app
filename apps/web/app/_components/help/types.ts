import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** One heading of an article; its title also feeds "On this page". */
export type ArticleSection = {
  id: string;
  title: string;
  body: ReactNode;
};

export type Article = {
  slug: string;
  title: string;
  /** One line for cards, search results and the page description. */
  summary: string;
  /** Extra words people might search for. */
  keywords?: string[];
  /** Text above the first heading. */
  lead: ReactNode;
  sections: ArticleSection[];
};

export type HelpSection = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  articles: Article[];
};
