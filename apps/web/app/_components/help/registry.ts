import { account } from "./content/account";
import { assistant } from "./content/assistant";
import { install } from "./content/install";
import { notes } from "./content/notes";
import { organize } from "./content/organize";
import { plan } from "./content/plan";
import { start } from "./content/start";
import type { Article, HelpSection } from "./types";

/** The help center, in reading order. */
export const HELP_SECTIONS: HelpSection[] = [start, install, plan, organize, notes, assistant, account];

export type ArticleRef = { section: HelpSection; article: Article; href: string };

export function articleHref(section: Pick<HelpSection, "id">, article: Pick<Article, "slug">) {
  return `/help/${section.id}/${article.slug}`;
}

export const ALL_ARTICLES: ArticleRef[] = HELP_SECTIONS.flatMap((section) =>
  section.articles.map((article) => ({ section, article, href: articleHref(section, article) })),
);

export function findArticle(sectionId: string, slug: string) {
  const index = ALL_ARTICLES.findIndex((ref) => ref.section.id === sectionId && ref.article.slug === slug);
  if (index === -1) return null;
  return { ...ALL_ARTICLES[index], previous: ALL_ARTICLES[index - 1] ?? null, next: ALL_ARTICLES[index + 1] ?? null };
}

/** What the search box needs; plain data so it can cross to the client. */
export type SearchEntry = {
  href: string;
  title: string;
  summary: string;
  section: string;
  terms: string;
};

export const SEARCH_INDEX: SearchEntry[] = ALL_ARTICLES.flatMap(({ section, article, href }) => [
  {
    href,
    title: article.title,
    summary: article.summary,
    section: section.title,
    terms: [article.title, article.summary, ...(article.keywords ?? [])].join(" ").toLowerCase(),
  },
  ...article.sections.map((part) => ({
    href: `${href}#${part.id}`,
    title: part.title,
    summary: article.title,
    section: section.title,
    terms: `${part.title} ${article.title}`.toLowerCase(),
  })),
]);
