import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronRight, Pencil } from "lucide-react";
import OnThisPage from "@/app/_components/help/onThisPage";
import { ALL_ARTICLES, findArticle } from "@/app/_components/help/registry";
import { ISSUES_URL } from "@/app/_components/site/links";

type Params = Promise<{ section: string; article: string }>;

export const dynamicParams = false;

export function generateStaticParams() {
  return ALL_ARTICLES.map(({ section, article }) => ({ section: section.id, article: article.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { section, article } = await params;
  const found = findArticle(section, article);
  if (!found) return {};
  return { title: found.article.title, description: found.article.summary };
}

export default async function HelpArticle({ params }: { params: Params }) {
  const { section: sectionId, article: slug } = await params;
  const found = findArticle(sectionId, slug);
  if (!found) notFound();
  const { section, article, previous, next } = found;
  const headings = article.sections.map(({ id, title }) => ({ id, title }));

  return (
    <div className="grid min-w-0 gap-10 xl:grid-cols-[minmax(0,1fr)_220px]">
      <article className="min-w-0 lg:max-w-[800px]">
        <div>
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-[var(--s-faint)]">
            <Link href="/help" className="hover:text-[var(--s-ink)]">
              Help
            </Link>
            <ChevronRight className="size-3.5" />
            <Link href={`/help#${section.id}`} className="hover:text-[var(--s-ink)]">
              {section.title}
            </Link>
          </nav>
          <h1 className="s-display mt-4 text-[2rem] leading-[1.1] font-semibold text-balance sm:text-[2.6rem]">
            {article.title}
          </h1>
          <div className="help-prose mt-5 text-[1.0625rem]">{article.lead}</div>
        </div>

        {/* Narrow screens get "On this page" inline, above the first heading. */}
        {headings.length > 1 ? (
          <div className="s-card mt-8 p-4 xl:hidden">
            <p className="text-xs font-semibold tracking-wide text-[var(--s-faint)] uppercase">On this page</p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {headings.map((heading) => (
                <li key={heading.id}>
                  <a href={`#${heading.id}`} className="s-link text-sm">
                    {heading.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="help-prose mt-2">
          {article.sections.map((part) => (
            <Fragment key={part.id}>
              <h2 id={part.id} className="group scroll-mt-24">
                <a href={`#${part.id}`} className="!text-inherit !no-underline">
                  {part.title}
                  <span aria-hidden className="ml-2 text-[var(--s-faint)] opacity-0 transition-opacity group-hover:opacity-100">
                    #
                  </span>
                </a>
              </h2>
              {part.body}
            </Fragment>
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--s-line)] pt-6 text-sm">
          <p className="s-faint">Something wrong or missing on this page?</p>
          <a href={ISSUES_URL} className="s-link inline-flex items-center gap-1.5 font-medium">
            <Pencil className="size-3.5" />
            Tell us on GitHub
          </a>
        </div>

        <nav aria-label="More articles" className="mt-6 grid gap-3 sm:grid-cols-2">
          {previous ? (
            <Link
              href={previous.href}
              className="group s-card s-card-hover p-4"
            >
              <span className="s-faint flex items-center gap-1.5 text-xs">
                <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
                Previous
              </span>
              <span className="mt-1 block font-medium">{previous.article.title}</span>
            </Link>
          ) : (
            <span className="hidden sm:block" />
          )}
          {next ? (
            <Link
              href={next.href}
              className="group s-card s-card-hover p-4 text-right"
            >
              <span className="s-faint flex items-center justify-end gap-1.5 text-xs">
                Next
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="mt-1 block font-medium">{next.article.title}</span>
            </Link>
          ) : null}
        </nav>
      </article>

      <aside className="hidden xl:sticky xl:top-24 xl:block xl:self-start">
        <OnThisPage headings={headings} />
      </aside>
    </div>
  );
}
