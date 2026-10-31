import { FileText } from "lucide-react";
import Link from "next/link";
import type { HelpSection } from "../types";
import { Callout, HelpLink, Path, Shot, Still } from "../ui";

export const notes: HelpSection = {
  id: "notes",
  title: "Docs, sheets and search",
  description: "Write docs, keep numbers in sheets, find anything, and arrange your Dashboard.",
  icon: FileText,
  articles: [
    {
      slug: "docs",
      title: "Docs",
      summary:
        "Nested pages with a block editor, Help me write, version history, and checklist items and lines you can turn into tasks.",
      keywords: [
        "doc",
        "document",
        "note",
        "page",
        "markdown",
        "mermaid",
        "katex",
        "math",
        "editor",
        "import",
        "export",
        "pdf",
        "zip",
        "daily note",
        "help me write",
        "ai writing",
        "rewrite",
        "slash menu",
        "mention",
        "image",
        "picture",
        "checklist",
        "to-do",
        "make task",
        "create task",
        "suggestions",
        "version history",
        "template",
      ],
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
                <strong>Files</strong> shows recent docs and sheets, with a tree on the left. From the top of the tree
                you can open today&apos;s daily note, start from a template, import a Markdown file as a doc or a CSV
                file as a sheet, and show archived files.
              </p>
              <p>
                Templates you made are marked <strong>Yours</strong> in the template list. Point at one and choose{" "}
                <strong>Delete template</strong> to remove it. You can delete your own templates on the phone too.
              </p>
              <Shot src="files" alt="Files page: the file list on the left, every doc and sheet as a row in the middle, and a preview of the selected file with the Library counts on the right." />
            </>
          ),
        },
        {
          id: "page",
          title: "The doc page",
          body: (
            <>
              <Still
                id="docs"
                alt="A doc titled Website launch brief with a note callout, a line turned into a linked task, headings, a bullet list and a table."
              />
              <ul>
                <li>
                  The tab strip at the top holds everything about the page. On its left are the
                  button that shows or hides the files list, <strong>Back</strong> and <strong>Forward</strong>. On its right
                  are the save status and the doc&apos;s buttons: <strong>Import Markdown</strong>,{" "}
                  <strong>Download</strong>, <strong>Use as a template</strong>, <strong>Version history</strong>,
                  favourite, <strong>Archive</strong> and <strong>Delete doc</strong>.
                </li>
                <li>
                  The editor toolbar is one row under the tabs, and the whole page scrolls as one.
                </li>
                <li>
                  When the doc has room, as in a wide window, the toolbar moves into a column on the left of the doc.
                  Pictures, embeds, diagrams, maths and the other blocks are then under its <strong>Insert</strong>{" "}
                  button. The outline and the doc&apos;s suggestions stay in view on the right as you scroll, and each line
                  offered as a task has a mark in the margin, level with it.
                </li>
                <li>A minimap of headings on the right jumps through long docs.</li>
              </ul>
            </>
          ),
        },
        {
          id: "editor",
          title: "Writing",
          body: (
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
              <li>
                Hover a block and click the grip on its left for its menu, or drag the grip to move the block.
              </li>
              <li>Docs save as you type.</li>
            </ul>
          ),
        },
        {
          id: "images",
          title: "Pictures",
          body: (
            <ul>
              <li>Paste or drop pictures to add them.</li>
              <li>
                Tall pictures are kept to a set height in the page. Double-click one, or choose{" "}
                <strong>View full size</strong> in its block menu, to see all of it. The block menu also has{" "}
                <strong>Download image</strong>.
              </li>
              <li>Copying a picture copies the picture itself, so you can paste it into other apps.</li>
            </ul>
          ),
        },
        {
          id: "phone",
          title: "On the phone",
          body: (
            <ul>
              <li>
                The <kbd>/</kbd> and <kbd>@</kbd> menus open above the keyboard, next to the toolbar, and the line you
                are typing stays in view above them.
              </li>
              <li>
                While the keyboard is up, the title, related items and suggestions step aside so you can see the doc.
              </li>
              <li>
                To add a picture you copied, paste it from the keyboard, type <kbd>/</kbd> and choose{" "}
                <strong>Paste image</strong>, or use <strong>Paste image</strong> in the toolbar. To copy a picture,
                put the cursor on it, tap <strong>Block</strong> in the toolbar and choose <strong>Copy image</strong>.
              </li>
            </ul>
          ),
        },
        {
          id: "markdown",
          title: "Markdown in and out",
          body: (
            <>
              <p>
                Use <strong>Import</strong> in Files or <strong>Import Markdown</strong> in a doc&apos;s tab strip to
                bring in a <code>.md</code> file. <strong>Download</strong> saves the doc as{" "}
                <strong>Markdown (.md)</strong> or as a <strong>PDF</strong>. A doc with uploaded pictures downloads
                as <strong>Markdown + images (.zip)</strong>: the <code>.md</code> file with an images folder it links
                to.
              </p>
              <p>
                Callouts, footnotes, properties (frontmatter), wiki links and Mermaid diagrams survive the round trip
                and also read well in GitHub and Obsidian.
              </p>
            </>
          ),
        },
        {
          id: "help-me-write",
          title: "Help me write",
          body: (
            <>
              <p>
                <strong>Help me write</strong> drafts right in the editor. Once an AI provider is set up in{" "}
                <Path>Settings &gt; Agent</Path>, it is the first button in the toolbar of every doc and task or
                project description. On the phone it is <strong>Write</strong> at the start of the toolbar. It is in
                the <kbd>/</kbd> menu too, on both.
              </p>
              <ul>
                <li>
                  With nothing selected, say what to write, or tap a starter: <strong>Outline</strong>,{" "}
                  <strong>Meeting notes</strong>, <strong>Continue writing</strong> or <strong>Summarize</strong> in a
                  doc, and <strong>Write a description</strong> or <strong>Break into steps</strong> in a description.
                </li>
                <li>
                  With text selected, it offers <strong>Improve</strong>, <strong>Shorter</strong>,{" "}
                  <strong>Longer</strong>, <strong>Fix spelling</strong>, <strong>Make steps</strong> and{" "}
                  <strong>Summarize</strong>, or say how to change it.
                </li>
                <li>
                  You see the draft first. Ask for changes to it, <strong>Try again</strong>, or{" "}
                  <strong>Discard</strong> it. Choose <strong>Insert</strong>, or <strong>Replace</strong> and{" "}
                  <strong>Insert below</strong> for selected text. Undo takes it back in one step.
                </li>
                <li>A long draft scrolls inside its preview, so you can read all of it before you choose.</li>
                <li>
                  On a wide doc page, Help me write opens in the right margin, level with the line it writes into, and
                  that line is tinted. It stays open while you edit the doc, and the draft still goes where you were
                  writing.
                </li>
                <li>
                  Closing the panel while it holds a prompt or a draft only hides it. Open Help me write again to
                  carry on; a draft that was still being written keeps going. A dot on the button means a draft is
                  waiting.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "to-tasks",
          title: "Checklist items to tasks",
          body: (
            <>
              <p>
                With <Link href="/help/assistant/smart-suggestions">smart suggestions</Link> on, unticked checklist
                items that read like something to get done, and are not tasks yet, are offered as tasks. Jev reads
                each item with its list and heading: &ldquo;Call the plumber&rdquo; is offered, &ldquo;Milk&rdquo; on
                a shopping list is not. The <strong>Not tasks yet</strong> card says how many there are and which
                project the tasks go to: the doc&apos;s project, else the one it seems to belong to.
              </p>
              <ul>
                <li>
                  On a wide page each offered item has a mark in the margin beside it. Click the mark, or the item in
                  the card, to see where its task goes, with <strong>Make task</strong> and <strong>Dismiss</strong>;
                  the arrows step through the doc&apos;s other offers. On a narrow page the card sits above the doc and
                  the item opens under its row.
                </li>
                <li>
                  <strong>Make task</strong> turns one item into a task, and <strong>Make all</strong> (or{" "}
                  <strong>Make 3 tasks</strong>) turns them all. Undo in the message takes them back.
                </li>
                <li>
                  The item&apos;s first sentence becomes the task&apos;s name and the rest its description, with a link
                  back to the doc. With an AI provider set up, your default model writes a short title and description
                  instead.
                </li>
                <li>
                  Items that are tasks already have a tick in the margin that opens the task, and are not offered
                  again. This holds after you reword the item.
                </li>
                <li>
                  Dismiss an item with its <strong>×</strong> and it is not offered again in that doc, on any device.
                </li>
                <li>
                  Turning off <strong>Offer tasks from checklists</strong> at the foot of the card stops the offers
                  for that doc. Turn them back on with the same switch beside a wide page, <strong>Task offers
                  off</strong> under the title of a narrow one, or the doc&apos;s <strong>More</strong> menu on the
                  phone.
                </li>
              </ul>
              <p>
                On the phone, the card is one row: tap it to see the suggestions, or tap <strong>Make all</strong>{" "}
                beside it. Each checklist row with a suggestion has a mark at its end. Tap it for{" "}
                <strong>Make task</strong> and <strong>Dismiss</strong>. A row that is a task already has a tick
                instead; tap the tick to open the task without bringing up the keyboard.
              </p>
            </>
          ),
        },
        {
          id: "suggestions",
          title: "Lines that read like a task",
          body: (
            <>
              <p>
                With <Link href="/help/assistant/smart-suggestions">smart suggestions</Link> on, a plain line that
                reads like something to do is offered as a task: &ldquo;Book the venue&rdquo; reads like a task.
              </p>
              <ul>
                <li>
                  <strong>Make task</strong>, from the line&apos;s mark or the <strong>Not tasks yet</strong> card,
                  makes a task named after the line. Its description says <strong>From</strong> with a link to the doc, and quotes the line.
                </li>
                <li>
                  A line is not offered again once it is a task, even after you or Help me write reword the line or
                  the task a little. Lines and tasks are matched by their words, not their exact text.
                </li>
                <li>
                  Only lines still in the doc are offered, so a half-typed line or one you since made a checklist item
                  is left out.
                </li>
                <li>
                  Dismiss a suggestion with its <strong>×</strong> and it stays gone for that doc on every device.
                </li>
              </ul>
              <p>
                Smart suggestions can also offer a template for a new page, the project the doc seems to belong to, a
                page to move it under, the kind of doc it reads like, properties as in your other docs, and a note when
                it may be out of date. Each one is a click to accept, with Undo where it moves or links the doc.
              </p>
            </>
          ),
        },
        {
          id: "assistant",
          title: "With the assistant",
          body: (
            <p>
              Ask in <Link href="/help/assistant/chat">chat</Link> to write a doc, add a section to one, or rewrite it:
              &ldquo;Write a launch brief for the website project with goals, risks and a checklist.&rdquo; With a doc
              open, the assistant sees it and any text you have selected. Adding to a doc applies straight away;
              replacing its text waits for your review.
            </p>
          ),
        },
        {
          id: "organize-docs",
          title: "Tabs, history and archive",
          body: (
            <ul>
              <li>
                Open several docs and sheets as tabs: <strong>+</strong> in the tab strip opens a new tab, and each
                tab has its own close button.
              </li>
              <li>
                <strong>Version history</strong> keeps one version for each editing session, plus one for each
                assistant change and each restore. The doc as it is now is marked <strong>Current</strong>. Pick an
                earlier one and choose <strong>Restore this version</strong>.
              </li>
              <li>Archive docs you are done with instead of deleting them; show archived files to find them again.</li>
            </ul>
          ),
        },
      ],
    },
    {
      slug: "sheets",
      title: "Sheets",
      summary:
        "Spreadsheets with typed columns, formulas across tabs, freeze panes, colour rules and templates, built or filled by the assistant.",
      keywords: [
        "sheet",
        "spreadsheet",
        "table",
        "formula",
        "function",
        "budget",
        "expenses",
        "csv",
        "template",
        "column",
        "column type",
        "format",
        "currency",
        "freeze",
        "frozen rows",
        "hide column",
        "filter",
        "colour rules",
        "conditional formatting",
        "tabs",
        "vlookup",
        "sumif",
        "mcp",
        "print",
      ],
      lead: (
        <p>
          Sheets are spreadsheets for budgets, lists and trackers, kept next to the work they belong to. Create one
          from Files, the <strong>+</strong> menu, or search.
        </p>
      ),
      sections: [
        {
          id: "grid",
          title: "The grid",
          body: (
            <>
              <Still
                id="sheets"
                alt="A sheet called Launch budget with Item, Category, Cost and Paid columns, dropdown chips, a SUM total, and the Dashboard card made from that total."
              />
              <ul>
                <li>
                  Select ranges, copy and paste, drag the fill handle, merge cells, and set number formats, colours,
                  alignment, borders and wrapping. The fill handle continues series of numbers, dates and months.
                </li>
                <li>
                  Inserting or deleting rows and columns keeps formulas pointing at the same cells, on every tab.
                </li>
                <li>Undo and redo cover every change. <strong>Print</strong> is in the toolbar.</li>
              </ul>
            </>
          ),
        },
        {
          id: "columns",
          title: "Columns",
          body: (
            <>
              <p>
                Each column has a type: Text, Number, Currency, Percent, Formula, Date, Checkbox or Dropdown. A value
                that does not fit the type is kept as you typed it.
              </p>
              <ul>
                <li>
                  Click the small type badge in a column&apos;s header, or right-click the header and choose{" "}
                  <strong>Type and format…</strong>. It opens under its column, and sets the type, the currency, the
                  date style and the decimal places for the whole column.
                </li>
                <li>
                  The header&apos;s right-click menu also has <strong>Rename column</strong>,{" "}
                  <strong>Sort A → Z</strong>, <strong>Sort Z → A</strong>, <strong>Filter by values…</strong> and{" "}
                  <strong>Hide column</strong>. A hidden column leaves a small marker in the header; click it to show
                  the column again.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "freeze",
          title: "Freeze rows and columns",
          body: (
            <>
              <p>
                <strong>Freeze rows and columns</strong> in the toolbar keeps the first rows or columns in view while
                the rest scrolls: one or two, or up to the selected cell. The row and column menus have{" "}
                <strong>Freeze up to row</strong> and <strong>Freeze up to column</strong> too.
              </p>
              <p>
                On the phone, frozen rows and columns stay put as well. Set them under <strong>Freeze</strong> in the{" "}
                <strong>Insert &amp; Tools</strong> part of the drawer under the grid, or with{" "}
                <strong>Freeze up to column</strong> in a column&apos;s menu. On a narrow screen the phone may pin
                fewer columns than you froze, so there is room to scroll.
              </p>
            </>
          ),
        },
        {
          id: "colour-rules",
          title: "Colour rules and tabs",
          body: (
            <ul>
              <li>
                <strong>Colour rules</strong> in the toolbar colours the cells of a column that pass a test, such as
                Greater than, Between, Contains, Is empty, Above average or Duplicate values.
              </li>
              <li>
                Add tabs at the bottom; each tab is its own grid. Right-click a tab, or use its{" "}
                <strong>Tab options</strong>, to rename, duplicate, colour, move or delete it. <strong>All tabs</strong>{" "}
                lists every tab of a long workbook.
              </li>
            </ul>
          ),
        },
        {
          id: "formulas",
          title: "Formulas",
          body: (
            <>
              <p>
                Start a cell with <code>=</code>. Ranges like <code>A1:B4</code>, whole columns like <code>C:C</code>{" "}
                and open ranges like <code>C2:C</code> work, and fill-down shifts them unless you fix a part with{" "}
                <code>$</code>, as in <code>$A$1</code>.
              </p>
              <p>
                Formulas can read other tabs: <code>=January!H2</code> or{" "}
                <code>=SUM(&apos;Jan 2026&apos;!H2:H)</code>. Renaming a tab updates the formulas that read it.
              </p>
              <p>
                <strong>Functions</strong> in the toolbar lists every function by group (Math, Conditional, Lookup,
                Logic, Text and Date) with a search, and a hint shows each function&apos;s parts as you type. Among
                them are <code>SUM</code>, <code>AVERAGE</code>, <code>ROUND</code>, <code>SUMIF</code>,{" "}
                <code>COUNTIFS</code>, <code>IF</code>, <code>IFERROR</code>, <code>VLOOKUP</code>,{" "}
                <code>XLOOKUP</code>, <code>INDEX</code>, <code>MATCH</code>, <code>TEXTJOIN</code>,{" "}
                <code>TODAY</code>, <code>EOMONTH</code> and <code>NETWORKDAYS</code>.
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
              <p>
                Agents you connect over <Link href="/help/assistant/mcp">MCP</Link> work with sheets too. They read
                the same worked-out values you see, add an entry by column name into the next free row, and edit any
                tab, which they pick by its name. On a sheet with several tabs, each edit names its tab, so an October
                receipt lands on the October tab.
              </p>
            </>
          ),
        },
        {
          id: "templates",
          title: "Templates and export",
          body: (
            <>
              <p>
                <strong>Save as template</strong> in the sheet&apos;s header saves a whole sheet or one tab to reuse,
                with its formulas and formatting. Templates are listed in Files, where you can also delete the ones you
                made.
              </p>
              <p>
                The built-in <strong>Yearly expenses</strong> template has a tab for every month, a summary with
                budgets, and spending by category. It is on the phone too.
              </p>
              <p>
                <strong>Export CSV</strong> in the sheet&apos;s header exports the current tab.
              </p>
            </>
          ),
        },
      ],
    },
    {
      slug: "search",
      title: "Search and commands",
      summary: "One box to find tasks, projects, docs, sheets and events, list tasks you describe in words, or create something new.",
      keywords: [
        "search",
        "command palette",
        "ctrl k",
        "cmd k",
        "find",
        "semantic",
        "natural language",
        "describe",
        "task view",
        "save as view",
        "filter",
        "preview",
      ],
      lead: (
        <p>
          Press <kbd>Ctrl</kbd> <kbd>K</kbd> (<kbd>Cmd</kbd> <kbd>K</kbd> on a Mac) anywhere to search. On the phone,
          it is the <strong>Search</strong> tab.
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
                Choose a result to open it, or an event to jump to it on the calendar. Type the name of one of your
                saved task views and <strong>Open view</strong> takes you to it.
              </p>
            </>
          ),
        },
        {
          id: "lists",
          title: "Describe a list of tasks",
          body: (
            <>
              <p>
                Type what you want to see in plain words, such as &ldquo;urgent tasks due this week&rdquo; or
                &ldquo;overdue tasks by project&rdquo;. Search reads them as a list of tasks and shows a card at the
                top: what it understood as chips, how many tasks match, and the first few. This needs no AI key.
              </p>
              <Shot
                src="search-views"
                alt="Search for open tasks due this week: a Suggested card reading 10 open tasks · Due this week with chips for Due this week, Open only and Soonest deadline first, a Save as view button, and the matching tasks below."
              />
              <ul>
                <li>Choose the card to open the list in Tasks as a <strong>Preview</strong> that is not saved.</li>
                <li>
                  <strong>Save as view</strong> saves it as one of your task views. Words like &ldquo;new view called
                  Bugs with high priority tasks&rdquo; show <strong>Create view</strong>, which saves it straight away.
                </li>
                <li>
                  With an AI provider set up, <strong>Read with AI</strong> reads the words the plain reading left out.
                  When it finds no list at all, <strong>Make a task view from these words</strong> asks your provider
                  instead.
                </li>
              </ul>
              <p>
                The phone&apos;s Search tab shows the same card, with <strong>Open</strong> and{" "}
                <strong>Save as view</strong>. See <Link href="/help/organize/views">Views</Link> for editing a view&apos;s
                rules.
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
      summary:
        "A grid of cards you arrange yourself: tools, ready-made charts, cards you build in the Card workshop, and live cards from sheets and docs.",
      keywords: [
        "dashboard",
        "report",
        "cards",
        "card workshop",
        "custom card",
        "chart",
        "graph",
        "pomodoro",
        "stopwatch",
        "journal",
        "stats",
        "widget",
        "home screen",
        "sheet card",
        "doc card",
        "counter",
        "quick add",
        "progress",
        "goal",
        "reorder",
      ],
      lead: (
        <p>
          The <strong>Dashboard</strong> is the first item in the sidebar, and a tab on the phone: a grid of cards you
          can drag, resize, add and remove. Your layout is saved and is the same on every device.
        </p>
      ),
      sections: [
        {
          id: "arrange",
          title: "Arrange it",
          body: (
            <>
              <Still
                id="cards"
                alt="Dashboard with cards for open tasks, done this week, overdue, a Pomodoro timer, today, planned hours by project, a sheet total, habits, reminders and week focus."
              />
              <p>
                Drag a card by its title to move it, or drag an edge or corner to resize it. Double-click a title to
                rename the card.
              </p>
              <p>
                A card&apos;s <strong>⋯</strong> button, or a right-click on its title, has <strong>Edit card…</strong>{" "}
                for cards you built, <strong>Rename</strong>, <strong>Size</strong> (Small, Medium, Large, Wide, Tall
                or Full width), <strong>Move earlier</strong>, <strong>Move later</strong>, <strong>Duplicate</strong>{" "}
                and <strong>Remove from dashboard</strong>. The <strong>⋯</strong> beside <strong>Add card</strong> has{" "}
                <strong>Reset to the default layout</strong>.
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
                <strong>Add card</strong> opens <strong>Add a card</strong>, with two lists to pick from and three ways
                to build your own card: <strong>Build a custom card</strong>, <strong>From a sheet</strong> and{" "}
                <strong>From a doc</strong>.
              </p>
              <p>
                <strong>Productivity tools:</strong> Pomodoro timer, Stopwatch and timer, Countdown, Quick capture,
                Scratchpad, Daily journal, Top 3 for today, Next up, Habits, Daily goal, Weekly review, Inbox zero,
                Priority matrix, Day and week, Completion streak, Focus time and Today. Highlights is there too while
                smart suggestions are on.
              </p>
              <p>
                <strong>Ready-made charts:</strong> Open tasks, Done this week, Overdue, Due in the next 14 days,
                Completed per day, Open by priority, Open tasks by project, Workload by due date, Weekly completion,
                Planned hours by workspace, Upcoming events, Event hours per day, Projects by status, Recently edited
                docs and Inbox.
              </p>
              <Callout kind="tip">
                A running Pomodoro shows in the Activity island in the sidebar, so you can see it from any page.
              </Callout>
            </>
          ),
        },
        {
          id: "workshop",
          title: "Build a card in the Card workshop",
          body: (
            <>
              <p>
                <strong>Build a custom card</strong> opens the <strong>Card workshop</strong>. Choose on the left; the
                preview on the right updates as you go. To begin from a ready-made chart, use{" "}
                <strong>Start from a template…</strong> at the top.
              </p>
              <Shot
                src="card-workshop"
                alt="The Card workshop set to Tasks data with a Number look and a Count measure, Deadline and All time range rows, filters, a live preview reading Open tasks 19 on the right, and an Add to dashboard button."
              />
              <ul>
                <li>
                  <strong>Data:</strong> Tasks, Projects, Events, Docs, Sheets, Reminders or Inbox.
                </li>
                <li>
                  <strong>Show as:</strong> Number, List, Bar chart, Line chart, Donut chart or Progress.
                </li>
                <li>
                  <strong>Measure:</strong> what to count (Count, Estimated hours, Tracked hours or Event hours), the
                  total or the average, and for charts what to group by, such as Status, Priority, Project, Label,
                  Day, Week or Month.
                </li>
                <li>
                  <strong>Time range:</strong> the date to use, such as Created, Completed or Deadline, and a range
                  such as Today, This week, Last 30 days, Next 7 days, All time or Custom dates.
                </li>
                <li>
                  <strong>Filters:</strong> Open, Done or All, and workspaces, projects, priority, status, labels,
                  Only overdue, Has a deadline, On the calendar, Repeating only and Name contains.
                </li>
                <li>
                  <strong>Display options:</strong> sorting and the number of rows for a list, the order and number of
                  groups for a chart, <strong>Compare with the period before</strong> for a number, a goal for
                  Progress, and a colour.
                </li>
              </ul>
              <p>
                Give the card a name and a size, then choose <strong>Add to dashboard</strong>. To change it later,
                choose <strong>Edit card…</strong> in its menu.
              </p>
            </>
          ),
        },
        {
          id: "from-files",
          title: "Cards from a sheet or a doc",
          body: (
            <>
              <p>
                <strong>From a sheet</strong> and <strong>From a doc</strong> make live cards that stay in step with
                the file on every device. Pick the file under <strong>Read from</strong>.
              </p>
              <p>For a sheet, pick the cells:</p>
              <ul>
                <li>
                  Drag across cells, or click a column letter to add or leave out that column. Hold{" "}
                  <kbd>Ctrl</kbd> (<kbd>Cmd</kbd> on a Mac) as you click or drag to add more columns, even ones that
                  are not next to each other. You can also type a range such as <code>A1:C6</code> or{" "}
                  <code>A1:A8, C1:D8</code>.
                </li>
                <li>
                  Pick the tab on a sheet with several. Turn on <strong>First row is names</strong> and{" "}
                  <strong>Keep reading rows added below</strong> as needed.
                </li>
                <li>
                  <strong>Show as:</strong> Value (one cell or the total), Table, Bars, Line, Donut, Progress (against
                  a number or another cell), Counter or Quick add.
                </li>
                <li>
                  A <strong>Counter</strong> has <strong>−</strong> and <strong>+</strong> that save into the cell;{" "}
                  <strong>Each tap adds</strong> sets the step. A cell with a formula can&apos;t count.{" "}
                  <strong>Quick add</strong> is a small form that adds a row to the sheet. A Table can let you{" "}
                  <strong>Edit values on the card</strong>.
                </li>
              </ul>
              <p>
                The card works its values out with the sheet&apos;s own formulas, so a change in the sheet redraws it.
              </p>
              <p>
                For a doc, pick the whole doc or the part under one heading, and show it as a <strong>Page</strong> or
                just its <strong>Checklist</strong>, with or without <strong>Hide ticked items</strong>. Ticks on the
                card save into the doc.
              </p>
            </>
          ),
        },
        {
          id: "phone",
          title: "On the phone",
          body: (
            <>
              <ul>
                <li>The phone loads your cards&apos; data when the app starts, so the Dashboard opens filled in.</li>
                <li>
                  <strong>+</strong> adds a card: <strong>Card from a sheet</strong>, <strong>Card from a doc</strong>,
                  a productivity tool or a ready-made chart. In <strong>Card from a sheet</strong>, tap the first cell
                  and then the last; tap the same cell twice for just that cell, or a column letter to add or leave
                  out that column.
                </li>
                <li>
                  The pencil, <strong>Edit dashboard</strong>, lists your cards. Drag a card by its grip to move it,
                  remove cards, or choose <strong>Reset to the default dashboard</strong>.
                </li>
                <li>Card sizes and the full Card workshop are on web and desktop. Cards you build there show on the phone.</li>
              </ul>
              <Callout kind="tip">
                On Android you can also place Dashboard cards on your home screen. See{" "}
                <HelpLink href="/help/start/widgets">Home-screen widgets</HelpLink>.
              </Callout>
            </>
          ),
        },
      ],
    },
  ],
};
