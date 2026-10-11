import Link from "next/link";
import { DocPage, SheetPage } from "./docsFigures";
import { ChapterHead, Fn, Footnotes, Page, Rv } from "./ui";

const DOCS = [
  ["Markdown", "type it, paste it, export it as .md"],
  ["Slash menu", "headings, to-dos, tables, toggles, columns"],
  ["Mermaid diagrams", "written as text, drawn as a chart"],
  ["Maths and callouts", "plus footnotes and version history"],
];

const SHEETS = [
  ["Typed columns", "text, number, currency, date and more"],
  ["Formulas", "SUM, AVERAGE, IF, ROUND and more"],
  ["Dropdowns and checkboxes", "and a fill handle"],
  ["Tabs and CSV export", "each tab is its own grid"],
];

function Spec({ title, rows, href }: { title: string; rows: string[][]; href: string }) {
  return (
    <Rv leader className="min-w-0">
      <h3 className="d2-serif text-[1.6rem] italic">{title}</h3>
      <dl className="mt-3 border-t border-[var(--rule-2)]">
        {rows.map(([term, detail]) => (
          <div key={term} className="flex flex-wrap items-baseline gap-x-2 border-b border-[var(--rule)] py-2.5 sm:flex-nowrap">
            <dt className="shrink-0 font-medium">{term}</dt>
            <span aria-hidden className="d2-leader hidden sm:block" />
            <dd className="d2-soft text-[0.95rem] sm:text-right">{detail}</dd>
          </div>
        ))}
      </dl>
      <Link href={href} className="d2-link mt-4 inline-block text-sm">
        Read: {title}
      </Link>
    </Rv>
  );
}

/** Chapter 3: docs and sheets as a printed spread. */
export default function ChapterDocs() {
  return (
    <section id="docs-and-sheets" aria-labelledby="docs-title" className="border-t border-[var(--rule-2)] py-20 sm:py-28">
      <Page>
        <ChapterHead
          n={3}
          head="Docs and sheets"
          headingId="docs-title"
          title="Notes and numbers, next to the work."
          lead={
            <>
              Every project can hold its own docs and sheets. Search finds them, and the assistant can write a doc or add
              rows to a sheet, for example from a photo of a receipt
              <Fn n={3} />.
            </>
          }
        />

        <Rv className="mt-14">
          <div className="d2-mono mb-2 hidden justify-between text-[10px] tracking-widest text-[var(--ink-3)] uppercase lg:flex">
            <span>verso · p. 18</span>
            <span>recto · p. 19</span>
          </div>
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-0">
            <div className="d2-sheet relative h-[500px] border border-[var(--rule-2)] lg:border-r-0">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 hidden w-12 bg-[linear-gradient(to_left,rgb(0_0_0/0.45),transparent)] lg:block" />
              <DocPage />
            </div>
            <div className="d2-sheet relative h-[500px] border border-[var(--rule-2)] lg:border-l-[var(--rule)]">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 hidden w-10 bg-[linear-gradient(to_right,rgb(0_0_0/0.4),transparent)] lg:block" />
              <SheetPage />
            </div>
          </div>
        </Rv>

        <div className="mt-14 grid gap-x-16 gap-y-12 lg:ml-[220px] lg:grid-cols-2">
          <Spec title="Docs" rows={DOCS} href="/help/notes/docs" />
          <Spec title="Sheets" rows={SHEETS} href="/help/notes/sheets" />
        </div>

        <Footnotes
          running="Docs and sheets"
          folio={22}
          notes={[
            {
              n: 3,
              text: "Docs and sheets live inside projects, next to the tasks they belong to, and both show up in Ctrl/Cmd+K search.",
            },
          ]}
        />
      </Page>
    </section>
  );
}
