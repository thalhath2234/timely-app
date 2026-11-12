# Timely design system

One kit for the desktop/web app (`apps/web`) and the phone app (`apps/mobile`). A control that exists on both looks and behaves the same way; the phone only gets taller touch targets. Use these components instead of styling a `<button>`, `<input>`, `<select>` or `Pressable` by hand.

Timely is a productivity tool: neutral surfaces, one accent colour, 600 weight for titles and buttons, small corner radii. Decoration is reserved for the landing page.

## Tokens

Source of truth: `packages/contract/src/designTokens.ts`.

- **Colours.** The web declares them as CSS variables in `apps/web/app/globals.css` (`:root` light, `.dark`), the phone reads the TypeScript file through `apps/mobile/lib/theme.ts`. `make test-design-tokens` fails when the two drift. On the phone `muted`/`secondary` map to the shared `fill` token (a control surface that stands out on a card).
- **Accent presets.** `ACCENT_PRESETS` is the same list on both apps; "default" is indigo `#4F46E5`.
- **Radii.** Controls 10px (web `rounded-md`), cards 12px (`rounded-lg`, 16px on the phone's larger cards), dialogs and sheets 20px. Pills (`rounded-full`) only for chips, badges and avatars.
- **Control heights.** Desktop sm 28 / md 32 / lg 36. Phone sm 36 / md 44 / lg 48.
- **Surfaces.** Four steps, each a little lighter (dark) or darker (light) than the one below: page `background`, `card`, panel2 (`muted`/`secondary`), raised (`fill`). Hairlines `border` and `input` are black or white at 8 % and 14 %, never a grey. A card sits on the page by tone; the shell draws no frame around a page and the rail shares the page colour.
- **Type.** Inter on web, the system font on the phone. Weights 400 body, 500 labels, 600 titles and buttons; nothing heavier, the phone's large title included. Page titles are 26px at −0.02em; eyebrows are 11 to 12px uppercase at 0.08em in `muted-foreground`.
- **Motion.** `motion` in `designTokens.ts`: one easing `cubic-bezier(0.16, 1, 0.3, 1)` (fast out, long settle), reveal 16 frames (530 ms, 14px rise), pop 10 frames (330 ms, 0.94 to 1), highlight 30 frames (1 s tint fade), stagger 3 frames (100 ms, capped at eight siblings), settle 12 frames. The landing film (`film/anim.ts`), the web kit (`_ui/motion.tsx`: `easeOut`, `revealTransition`, `listItemVariants`, `staggerDelay`) and the phone (`lib/motion.ts`) read the same values. Reduce motion follows the OS unless the user picks Animate or Reduce in Appearance; when it is on, everything becomes a short cross-fade.
  - **Catalogue (web kit, `_ui/`).** Page and rail cards rise with `Reveal` / `revealProps(index)` (`motion.tsx`; `PageWithRail` reveals the main pane and each rail card in turn); lists use `listContainerVariants` or `revealProps` per row. Overlays pop from 0.96 in 10 frames (`globals.css` view transitions, `panelVariants`); only the named overlay is snapshotted, the page and the scrim stay live (`:root { view-transition-name: none }`, `.scrim-enter`). A card hovers with the `lift` class (1 px up, hairline 8 % to 14 %, no shadow). Loading shows `Skeleton`, `SkeletonRows`, `SkeletonCards` or `SkeletonLines` (`skeleton.tsx`), never a spinner or "Loading…". Data that changes goes through `dataMotion.tsx`: `StatNumber` pops and counts up (above 10), `ChangeTint` (with `useChangeKey`) tints the card for a second, `Fill` animates a bar from its previous share over 20 frames. Completing a task uses `TaskCheck` and `StrikeTitle` (`taskCheck.tsx`): fill 6 frames, strike 10 frames. Calendar blocks are `motion` elements: a block that arrives after first paint rises with a tint flash (6-frame stagger in time order), a moved block slides. Sheet cells: selection ring pops (`.sheet-sel`), a recalculated cell tints (`.sheet-changed-*`), an inserted row slides open (`.sheet-row-in`).

## Button

Web `app/_components/_ui/button.tsx` (`Button`, `buttonClass` for links). Phone `Button` in `components/ui/primitives.tsx`.

| Variant | Use for |
|---|---|
| `primary` | The one main action of a screen, dialog or form. At most one per area. |
| `secondary` | A filled neutral action beside a primary (Cancel in a confirm sheet). |
| `outline` | A page-level action that is not the main one (Import, Duplicate, Mark all read). |
| `ghost` | Toolbar and row actions; chrome appears on hover. |
| `destructive` | Delete, Clear all, Sign out everywhere, in a confirmation. |
| `destructive-ghost` (web) | A quiet Delete or Log out next to other actions in a row or dialog footer. |
| `link` (web) | An inline text action inside copy or a row (Review, Open). |

Sizes: web `sm` 28px in rows and toolbars, `md` 32px by default (page header actions, dialog footers), `lg` 36px next to an `lg` input. Phone `sm` 36px inside cards, `md` 44px by default, `lg` 48px for the action under a form (`PrimaryButton` is primary + lg + full width).

States: hover darkens (web), press dims (phone), disabled is 50% opacity, `loading` swaps the leading icon for the animated Timely logo and blocks presses. Icon-only buttons are `icon` on the web (square) and need an `aria-label`. The app has only two keyboard shortcuts, Ctrl/Cmd+K (search) and Ctrl/Cmd+Shift+J (agent), so buttons and menu rows show no key hints.

## Inputs

Web `app/_components/_ui/field.tsx`: `Input`, `Textarea`, `Field` (label, control, hint or error) and `controlClass(size)`, the shared surface used by `Select`, `DatePicker`/`DateField`/`TimeField` and `Input`, so a row of mixed controls lines up. Bordered, card-coloured, `rounded-md`, focus ring in the accent.

Phone `Field` (`label`, `hint`): 48px, 12px corners, 1px border that turns accent on focus. Every field has a visible label unless the screen title already names it (a search box); a placeholder is not a label.

## Select (dropdown)

Web `app/_components/_ui/select.tsx`: same trigger as `Input` (`size` sm/md/lg), `variant="bare"` for a value inside a property row. Never use a native `<select>`. The open menu uses `popoverSurface` and `menuItemClass` from `field.tsx`.

Phone `Select` in `primitives.tsx`: field-looking trigger (`label` optional) that opens a bottom sheet of `SheetOption`s; `trigger="row"` draws it as a settings row (label left, value and chevron right) for use inside a `ListGroup`.

## Date and time

Always Timely's own picker, never `<input type="date|time">` and never a typed "HH:mm".

- Web: `DatePicker`, `DateField`, `TimeField`, `DateTimeField` in `app/_components/_ui/datePicker.tsx`; triggers use `controlClass`.
- Phone: `DateField` and `TimeField` in `components/ui/DateTimeField.tsx` (a field row that opens `DateTimeSheet`), or `DateTimeSheet` directly for custom triggers. `TimeField compact` is a small time pill for a row (working hours, digest times).

## Segmented control

Switching views or modes (List/Kanban, Day/Week/Month, All/Docs/Sheets, System/Light/Dark). A muted track with the active segment raised on a card, not filled with the accent. Web `app/_components/_ui/segmentedControl.tsx` (sm 28 / md 32), phone `components/ui/SegmentedControl.tsx`.

## Page header

Web `app/_components/_ui/pageHeader.tsx`: 26px semibold title at −0.02em, optional `PageBadge` count, actions on the right as `md` buttons with the primary last, `px-6 pt-5 pb-4`. A description is for a line that carries data (a date, a count); a sentence that only describes the page is left out, and what the page just did goes in a state line at the bottom of the page instead.

Phone `MobileHeader`: tab roots (Today, Tasks, Calendar, Bots, Search, Files) use the large 28px title; every pushed screen (`back`) uses the compact 17px title. `large` defaults to `!back`.

## Page with rail

Web `app/_components/_ui/pageWithRail.tsx`: the layout system for app pages. The page's own content on the left and a rail of supporting cards on the right (`railWidth` 300–340px, 320 by default), as one grid from xl (1280px) up; narrower windows put the rail's cards under the content, two per row. `sticky` keeps a short rail in view while a long page scrolls.

The rail carries what the page does not say by itself: the numbers (a `RailStat`, the film's big figure over a small label), the next steps and the settings people change most, each as a `RailSection` card of `RailRow`s (a colour dot and label on the left, the value or a `ListSwitch` on the right, an optional second line and a thin share bar). Today puts habits, reminders, overdue and the wrap-up there and keeps focus and the day's clock side by side; Projects shows time planned per project over the next seven days, deadlines and projects by status; Notifications what is waiting and the delivery switches; Files new sheets from templates and the library's counts; Settings a live preview on Appearance and the open workspace's statuses, labels and fields on Workspaces; a wide doc the outline card (words, reading time, headings that jump) above the margin suggestions. A rail never holds filler: with nothing to say, the card says so in one `RailEmpty` line or the page has no rail.

## Sheets and create forms

On the phone, `BottomSheet` in `components/ui/BottomSheet.tsx` is the phone's one pop-up: a grabber (pull it or the header down to close), a header with the title (or a `leading` control such as Quick add's kind chip, plus an optional `subtitle`) and a close button, a scrolling body and an optional `footer` action bar.

- **Keyboard.** While the keyboard is up the sheet sits on top of it (`useKeyboardCover`, which adds Android's navigation bar back), so the footer is always the row right above the keys. Never put a form's main button inside the scrolling body.
- **Pickers open in place.** A `BottomSheet` rendered inside another open sheet (a `Select`, a `DateTimeSheet`, a status list) does not stack a second sheet: it replaces the body with a back arrow, its title, and the parent's title as the subtitle. Back, the backdrop and Android back return to the form. `presentation="modal"` opts out for the rare sheet that must sit on top. A page can open its own picker (a field's Type on its edit page): earlier pages stay mounted underneath, and Back returns to them with their state.
- **Settings screens** (a workspace, project settings) show a summary first and edit in sheets: `ListGroup`/`ListRow` in `components/settings/SettingsList.tsx` (one card, hairline dividers, 48px rows, a `tone="add"` "+ New …" row last), each row opening an edit page of the sheet with Save in the footer and Delete as a quiet destructive button in the body, confirmed by a `ConfirmSheet` page. No inline add forms or Edit/Remove text links. Settings pages with inline values (Schedule, Account, Notifications, Data & backups) use the same groups: `GroupLabel` above, `GroupHint` below, `ListRow` with a `trailing` control (a bare `Field`, a time pill, a `size="sm"` `SegmentedControl`) and `SwitchRow`/`ListSwitch` for on/off, never the native `Switch`.
- **Create forms and details are grouped rows.** Quick add, New project, the task and event details screens and a project's screen (properties, Tasks by stage, Activity) use the Settings groups too: a large bare title (and notes), then cards of rows with the label on the left and the value on the right (muted 13/500, a dot for a coloured value, a tint only when it carries meaning such as High priority). A multi-pick (labels, a multi-select field) is one summary row ("Design, Bug +1") that opens a page of `SheetOption`s; Repeat is one row that opens the presets as a page, with Custom as a card of rows under them (Every stepper, Unit, On day dots, Ends) (`RepeatRow`, `LabelsRow` and `CustomFieldsGroup` in `components/tasks/TaskMetaRows.tsx`, shared by Quick add and task details). On/off is a `SwitchRow`, a small choice a `size="sm"` `SegmentedControl`, short text an inline right-aligned `Field bare align="right"`. Quick add ends with a "More options" row that reveals the Auto-schedule card, Labels and Custom fields. The footer is a live summary of where the item lands and when, plus one primary button (Create, or Capture for the Inbox).
- **Desktop create dialog and task details.** `CreateDialogShell` and `CreateDialogFooter` in `app/_components/_ui/modal/entityModal.tsx` give the web add-item form the same anatomy: a kind chip in the header that switches the form in place (a typed title comes along), the title, notes whose toolbar shows only while you write in them (`RichTextEditor toolbar="focus"`), then the same cards as the phone, built from `ListGroup`, `ListRow`, `GroupLabel`, `GroupHint` and `ListSwitch` in `app/_components/_ui/groupedList.tsx`. Values use the row variants: `Select variant="row"` (with `values` for a multi-pick), `DatePicker`/`TimeField`/`DateTimeField variant="row"`, `ColorPicker variant="row"`, `RecurrenceEditor` (a Repeat row whose Custom rows join the same card, like the phone's Repeat page), `CustomFieldControl variant="row"`, and `CreateLabelInline`/`CreateCustomFieldInline variant="row"` as the card's last "+ New …" row. Wide dialogs put two cards side by side. The dialog is 720px wide (560px for a doc, sheet or workspace), as tall as its content, and sits near the top of the screen so "More options" grows it downward. The task details sidebar uses the same cards (Details, Dates, Schedule, Auto-schedule, Custom fields), and so do the calendar block and "Add to calendar" dialogs.

## Permission chip and agent runs

How much the assistant may change without asking (`packages/contract/src/agentChat.ts` holds the words). Web `app/_components/chat/permissionPicker.tsx`:

- **Chip.** A pill in the mode's tone: green eye Supervised, indigo shield Auto, amber bolt Full Access (with a hairline in its tone). `md` (28px) leads the composer's toolbar, `sm` (22px) is a settings row's value.
- **Picker.** A 400px popover of three radio rows (icon tile, name, description; the picked row on `primary/10`), an eyebrow title, and for one chat the footer "Only this chat. New chats start on …" with Change default. The composer's opens over the composer box, so it fits a phone-width window. Picking Full Access asks first in a `primary` confirmation that says what still asks.
- **Settings → Agent.** The Engine card (a `size="sm"` SegmentedControl, plus a wrapping row saying why New can't run) and the Permissions groups (New chats and Bots rows with the chip and a chevron, "Auto always asks before", Full Access, the lock note) sit in a 340px column beside the providers from xl up, and above them on narrower windows.
- **Agent runs** (`chat/agentRun.tsx`). While a run works, a card of activity lines (a check when done, the logo while running, a cross when failed; the newest six) and the reply as it streams, with an accent caret. A proposal that applied on its own is the "Ran on its own · Auto" card: an eyebrow, one line per change, a ghost Undo on the last line, and "See the changes" for the full cards; once undone, the lines strike through under an Undone pill.

## What the agent learned

What the assistant saved from a chat (plan 9b.4; words and helpers in `packages/contract/src/agentLearning.ts`, shared with the phone). Web `app/_components/chat/turnLearning.tsx`, Settings `app/_components/settings/learned*.tsx`.

- **Learning chip.** Under the agent reply whose run (`agentRun`) learned something, after the reply's text and past the avatar: a muted `rounded-[14px]` strip (it can wrap, so not a full pill) with a lightbulb in the accent, the change in 12/500 ("Learned: skill 'bank-csv-import' created", "… and 2 more"), "· applies from your next chat" for About you and Notes, then View and Undo as quiet text buttons. View links to the change in Settings (`/settings?tab=learned&skill=…` or `&part=about|notes`); Undo takes back every live change of the turn, then the strip reads "Undone" with an undo icon and no buttons. Staged and blocked changes are never on the chip.
- **Keep / Discard card.** When the turn's changes were staged (the chat read outside content, or a bot wrote it; Q-3.1): a card (`rounded-xl`, `bg-card`, at most 86% wide like the "Ran on its own" card) with option 1's header, a 32px `primary/10` tile with the lightbulb, the title "Keep what Timely learned?" (or the bot's name) and the one-line reason; then one row per change, hairline above it: the change ("Skill “flipkart-price-read” updated") over its summary, and on the right ghost "View diff" (a chevron that turns), ghost Discard and a `primary` `sm` Keep. View diff opens the change below the row in `DiffView`.
- **Diff.** `chat/diffView.tsx`: a unified diff as mono 12px lines on `muted/40`, added lines on `success/10` with "+", removed on `destructive/10` with "−", file headers left out, at most 320px tall and scrolling. Used by the card, Waiting for you, a skill's history and Updated upstream.
- **Don't learn from this chat.** The chat header's "…" menu (`chat/chatMenu.tsx`), only in chats on the New engine: one checkbox row with a line under it. When on, the conversation starts with a muted pill note "Timely won't learn from this chat" and a "Let it learn" link.
- **Settings › What Timely learned.** Its own Settings tab (the Agent tab was already long), reached from the Agent tab's summary row ("What Timely learned", "14 skills · About you · 1 waiting", a lightbulb tile and a chevron, under the permissions). The same two-column layout as Agent: the Learning card (Learn from chats, Search my past chats, `ListSwitch`es) and "Download what Timely learned" in the 340px column, above the lists on narrow windows. The lists are grouped cards: Waiting for you (only while something waits), Skills (name, provenance line, tags such as "Restored, review" in the warning tone, Locked, Archived, Unused; a switch on the right; a row opens its content, actions and history below it; built-in skills fold under one row), Updated upstream (Compare, Keep mine, Use new), About you and Notes (the budget "1,104 of 1,375" as the group's aside and a 4px `Fill` under the label, accent, then warning from 90%, destructive when full; entries wrap; Edit and Delete per entry, a "+ Add" row last, Undo in the toast), and Activity (newest first, Undo or a status tag, "Show earlier"). No Learning model row: learning uses the chat's model.
- **Web search** (Settings › Agent, `settings/webSearchKey.tsx`): one row, like the Finnhub key. Without a key it reads "Uses Claude Code's own search" (warning text "… can't search the web. Add a search key." when the provider can't); with one, "Search key · Brave Search · ••••a1b2" with Change and Remove. The form offers only the backends the server lists.

## Busy states

The animated Timely logo (`LogoSpinner`, `LogoLoader`) wherever a spinner would be, on both apps.

## Empty states

`EmptyState` (`app/_components/_ui/emptyState.tsx`) with a `loop`: a card holding a four-second film loop of the thing to do (320 to 400 px, from `app/_components/film/loops/`, drawn with the film kit and played muted through `@remotion/player`) beside one line of copy and the action. Loops rest on their finished frame when motion is reduced, play only while on screen, and load only with the page that shows them. Inbox, Projects, Files, Dashboard, the Bots page's hero card and the assistant's hero use one; a loop without an `EmptyState` sits in its own bordered `bg-panel` box. Without a `loop`, the centred dashed card. Edit loops in Studio (`make film-studio`, folder Loops); `make film-render-loops` writes them as animated WebP for the phone (`ONLY=<id>` renders one and leaves the others untouched).

## Week in review

Today's End of day card opens "Week in review" (`app/_components/today/weekReview.tsx`): the week that holds today as a fifteen-second, 16:9 film in three chapters, built from the user's own tasks, calendar, focus sessions, docs and sheets (`app/_components/film/review/plan.ts` turns the queries into pure data; `review/review.tsx` is the composition, also in Studio as WeekInReview). Chapter one is the three film stat cards (done, focused, planned) counting up over a finished-by-day strip, chapter two the week grid with every block arriving in time order and the done ones ticked, chapter three the shipped list beside the docs and sheets touched, closing on what waits for next week. The dialog plays it through `@remotion/player`; "Save as video" renders the same composition in the browser with `@remotion/web-renderer` (WebCodecs, no server, no headless Chrome) and hands it to the native save dialog, or a download where there is none. It takes the first format the browser can encode, MP4 (H.264) where there is a hardware or system encoder, else WebM (VP9, then VP8), and the file name and note follow; the button shows only where one of them works (`canRenderMediaOnWeb`), so Firefox keeps the Player alone. That renderer paints the DOM itself and supports a subset of CSS, so review scenes stay within it: inline styles, DOM order instead of z-index, no backdrop blur or inset shadows.
