import { FileText } from "lucide-react";
import Link from "next/link";
import type { HelpSection } from "../types";
import { Callout, Path, Shot } from "../ui";

export const notes: HelpSection = {
  id: "notes",
  title: "Docs, sheets and search",
  description: "Write docs, keep numbers in sheets, find anything, and arrange your Dashboard.",
  icon: FileText,
  articles: [
    {
      slug: "docs",
      title: "Docs",
      summary: "Nested pages with a block editor that speaks Markdown, diagrams and maths, and an assistant that writes them.",
      keywords: ["doc", "document", "note", "page", "markdown", "mermaid", "katex", "math", "editor", "import", "export", "daily note"],
      lead: (
        <p>
          Docs live in <strong>Files</strong>, next to your sheets. A doc can hold other docs as subpages, link to a
          project, and be marked as a favourite. Everything you write can be exported to Markdown and imported back
          unchanged.
        </p>
      ),
      sections: [
        {
          id: "files",
          title: "Files",
          body: (
            <>
              <p>
                <strong>Files</strong> (<kbd>g</kbd> then <kbd>f</kbd>) shows recent docs and sheets, with a tree on
                the left. From the top of the tree you can open today&apos;s daily note, start from a template, import
                Markdown, and show archived files.
              </p>
              <Shot src="files" alt="Files page: a tree of docs and sheets on the left and cards for recent files on the right." />
            </>
          ),
        },
        {
          id: "editor",
          title: "Writing",
          body: (
            <>
              <Shot
                src="doc"
                alt="A doc titled Website launch brief with a note callout, headings, a bullet list and a table."
              />
              <ul>
                <li>
                  Type <kbd>/</kbd> for the block menu: headings, lists, to-dos, tables, code, dividers, callouts,
                  toggles, columns, images, embeds and new subpages.
                </li>
                <li>
                  Type <kbd>@</kbd> to mention a doc, sheet, task or project. Mentions are links, and they feed the
                  Dashboard&apos;s links graph.
                </li>
                <li>
                  Markdown shortcuts work as you type: <code>#</code> for headings, <code>-</code> for lists,{" "}
                  <code>[ ]</code> for to-dos, <code>```</code> for code.
                </li>
                <li>
                  Code blocks have a language picker and a copy button. A <code>mermaid</code> code block draws a
                  diagram; <code>$…$</code> and <code>$$…$$</code> write maths.
                </li>
                <li>Paste or drop pictures to add them. Docs save as you type.</li>
              </ul>
            </>
          ),
        },
        {
          id: "markdown",
          title: "Markdown in and out",
          body: (
            <p>
              Use <strong>Import</strong> in Files or a doc&apos;s menu to bring in a <code>.md</code> file, and the
              download button in a doc&apos;s header to export one. Callouts, footnotes, properties (frontmatter), wiki
              links and Mermaid diagrams survive the round trip and also read well in GitHub and Obsidian.
            </p>
          ),
        },
        {
          id: "assistant",
          title: "With the assistant",
          body: (
            <>
              <p>
                Ask in <Link href="/help/assistant/chat">chat</Link> to write a doc, add a section to one, or rewrite
                it: &ldquo;Write a launch brief for the website project with goals, risks and a checklist.&rdquo; With
                a doc open, the assistant sees it and any text you have selected. Adding to a doc applies straight
                away; replacing its text waits for your review.
              </p>
              <p>
                With <Link href="/help/assistant/smart-suggestions">smart suggestions</Link> on, a card at the top of
                a doc can offer a template for a new page, the project it seems to belong to, or a page to move it
                under. Each one is a click to accept, with Undo.
              </p>
            </>
          ),
        },
        {
          id: "organize-docs",
          title: "Tabs, history and archive",
          body: (
            <ul>
              <li>
                In the desktop app, open several docs and sheets as tabs: <kbd>Ctrl</kbd> <kbd>T</kbd> for a new tab,{" "}
                <kbd>Ctrl</kbd> <kbd>W</kbd> to close one.
              </li>
              <li>Open a doc&apos;s history to see earlier versions and restore one.</li>
              <li>A minimap of headings on the right jumps through long docs.</li>
              <li>Archive docs you are done with instead of deleting them; show archived files to find them again.</li>
            </ul>
          ),
        },
      ],
    },
    {
      slug: "sheets",
      title: "Sheets",
      summary: "Light spreadsheets with typed columns, formulas, tabs and templates, built or filled by the assistant.",
      keywords: ["sheet", "spreadsheet", "table", "formula", "budget", "csv", "template", "column"],
      lead: (
        <p>
          Sheets are small spreadsheets for budgets, lists and trackers, kept next to the work they belong to. Create
          one from Files, the <strong>+</strong> menu, or search.
        </p>
      ),
      sections: [
        {
          id: "grid",
          title: "The grid",
          body: (
            <>
              <Shot
                src="sheet"
                alt="A sheet called Launch budget with Item, Category, Cost and Paid columns, dropdown chips and a SUM total."
              />
              <ul>
                <li>
                  Columns have a type: text, number, currency, percent, date, checkbox, formula, or a dropdown of
                  options.
                </li>
                <li>
                  Select ranges, copy and paste, drag the fill handle, merge cells, and set number formats, colours,
                  alignment, borders and wrapping.
                </li>
                <li>Filter rows and sort columns while you work. Undo and redo cover every change.</li>
                <li>Add tabs at the bottom; each tab is its own grid.</li>
              </ul>
            </>
          ),
        },
        {
          id: "formulas",
          title: "Formulas",
          body: (
            <>
              <p>
                Start a cell with <code>=</code>. Ranges like <code>A1:B4</code>, whole columns like <code>C:C</code>{" "}
                and open ranges like <code>C2:C</code> work, and fill-down shifts them.
              </p>
              <p>
                Functions include <code>SUM</code>, <code>AVERAGE</code>, <code>MIN</code>, <code>MAX</code>,{" "}
                <code>COUNT</code>, <code>ROUND</code>, <code>IF</code>, <code>AND</code>, <code>OR</code>,{" "}
                <code>CONCAT</code>, <code>LEN</code>, <code>UPPER</code>, <code>TODAY</code>, <code>DATE</code>,{" "}
                <code>WEEKDAY</code>, <code>DAYS</code> and <code>TEXT</code>. Formulas can&apos;t refer to other tabs
                yet.
              </p>
            </>
          ),
        },
        {
          id: "assistant",
          title: "With the assistant",
          body: (
            <>
              <p>
                Ask in <Link href="/help/assistant/chat">chat</Link> for a sheet and describe it: &ldquo;Make a launch
                budget with item, category, cost and paid columns, and a total.&rdquo; The assistant can also add
                columns, rows and tabs to an open sheet or fill in cells. A new sheet that already has data, and
                anything that removes or replaces what is there, waits for your review.
              </p>
              <Callout kind="tip">
                Attach a photo of a receipt in chat and the assistant adds it to your expense sheet after you check
                the details. See <Link href="/help/assistant/chat#receipts">Receipts to your expense sheet</Link>.
              </Callout>
            </>
          ),
        },
        {
          id: "templates",
          title: "Templates and export",
          body: (
            <p>
              Save a whole sheet or one tab as a template to reuse it, with its formulas and formatting. Templates are
              listed in Files. Export the current tab as CSV from the sheet&apos;s header.
            </p>
          ),
        },
      ],
    },
    {
      slug: "search",
      title: "Search and commands",
      summary: "One box to find tasks, projects, docs, sheets and events, or to create something new.",
      keywords: ["search", "command palette", "ctrl k", "cmd k", "find", "semantic"],
      lead: (
        <p>
          Press <kbd>Ctrl</kbd> <kbd>K</kbd> (or <kbd>/</kbd>) anywhere to search. On the phone, it is the{" "}
          <strong>Search</strong> tab.
        </p>
      ),
      sections: [
        {
          id: "find",
          title: "Find things",
          body: (
            <>
              <Shot
                src="search"
                alt="The search box over the calendar with the query launch and results: a sheet, two tasks, a project and a doc."
              />
              <p>
                Results cover sheets, docs, tasks, projects and events; the tabs at the top narrow them to one kind.
                Choose a result to open it, or an event to jump to it on the calendar.
              </p>
            </>
          ),
        },
        {
          id: "commands",
          title: "Run commands",
          body: (
            <p>
              The same box creates a task, project, event, doc or sheet, and jumps to any page. If search itself is
              unavailable, the commands still work.
            </p>
          ),
        },
        {
          id: "semantic",
          title: "Search by meaning",
          body: (
            <Callout kind="tip">
              Add an OpenRouter key in <Path>Settings &gt; Agent</Path> and search also finds things by meaning, so
              &ldquo;holiday&rdquo; finds &ldquo;Book flights for December&rdquo;. Without a key, search matches
              words.
            </Callout>
          ),
        },
      ],
    },
    {
      slug: "dashboard",
      title: "Dashboard",
      summary: "A grid of cards you arrange yourself: stats, timers, habits, a journal and more.",
      keywords: ["dashboard", "report", "cards", "pomodoro", "stopwatch", "journal", "stats", "widget"],
      lead: (
        <p>
          The <strong>Dashboard</strong> (<kbd>g</kbd> then <kbd>d</kbd>) is the first item in the sidebar: a grid of
          cards you can drag, resize, add and remove. Your layout is saved.
        </p>
      ),
      sections: [
        {
          id: "arrange",
          title: "Arrange it",
          body: (
            <>
              <Shot
                src="dashboard"
                alt="Dashboard with cards for open tasks, done this week, overdue, weekly completion, today, a Pomodoro timer and open by priority."
              />
              <p>
                Drag a card by its title to move it, or drag an edge or corner to resize it. <strong>Add card</strong>{" "}
                opens the card workshop. You can always reset to the default layout.
              </p>
            </>
          ),
        },
        {
          id: "cards",
          title: "Cards you can add",
          body: (
            <>
              <p>
                <strong>Tools:</strong> Pomodoro timer, Stopwatch and timer, Countdown, Quick capture, Scratchpad,
                Daily journal, Top 3 for today, Next up, Habits, Daily goal, Weekly review, Inbox zero, Priority matrix,
                Day and week, Completion streak, Focus time, Highlights and Today.
              </p>
              <p>
                <strong>Stats:</strong> Open tasks, Done this week, Overdue, Due in the next 14 days, Completed per
                day, Open by priority, Open tasks by project, Workload by due date, Weekly completion, Planned hours by
                workspace, Upcoming events, Event hours per day, Projects by status, Recently edited docs and Inbox.
              </p>
              <Callout kind="tip">
                A running Pomodoro shows in the Activity island in the sidebar, so you can see it from any page.
              </Callout>
            </>
          ),
        },
      ],
    },
  ],
};
