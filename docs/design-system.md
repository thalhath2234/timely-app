# Timely design system

One kit for the desktop/web app (`apps/web`) and the phone app (`apps/mobile`). A control that exists on both looks and behaves the same way; the phone only gets taller touch targets. Use these components instead of styling a `<button>`, `<input>`, `<select>` or `Pressable` by hand.

Timely is a productivity tool: neutral surfaces, one accent colour, 600 weight for titles and buttons, small corner radii. Decoration is reserved for the landing page.

## Tokens

Source of truth: `packages/contract/src/designTokens.ts`.

- **Colours.** The web declares them as CSS variables in `apps/web/app/globals.css` (`:root` light, `.dark`), the phone reads the TypeScript file through `apps/mobile/lib/theme.ts`. `make test-design-tokens` fails when the two drift. On the phone `muted`/`secondary` map to the shared `fill` token (a control surface that stands out on a card).
- **Accent presets.** `ACCENT_PRESETS` is the same list on both apps; "default" is indigo `#4F46E5`.
- **Radii.** Controls 10px (web `rounded-md`), cards 12px (`rounded-lg`, 16px on the phone's larger cards), dialogs and sheets 20px. Pills (`rounded-full`) only for chips, badges and avatars.
- **Control heights.** Desktop sm 28 / md 32 / lg 36. Phone sm 36 / md 44 / lg 48.
- **Type.** Inter on web, the system font on the phone. Weights 400 body, 500 labels, 600 titles and buttons; 700 only for the phone's large screen title.

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

Web `app/_components/_ui/pageHeader.tsx`: 24px semibold title, optional `PageBadge` count, one-line description, actions on the right as `md` buttons with the primary last, `px-6 pt-5 pb-4`.

Phone `MobileHeader`: tab roots (Today, Tasks, Calendar, Search, Files) use the large 28px title; every pushed screen (`back`) uses the compact 17px title. `large` defaults to `!back`.

## Sheets and create forms

On the phone, `BottomSheet` in `components/ui/BottomSheet.tsx` is the phone's one pop-up: a grabber (pull it or the header down to close), a header with the title (or a `leading` control such as Quick add's kind chip, plus an optional `subtitle`) and a close button, a scrolling body and an optional `footer` action bar.

- **Keyboard.** While the keyboard is up the sheet sits on top of it (`useKeyboardCover`, which adds Android's navigation bar back), so the footer is always the row right above the keys. Never put a form's main button inside the scrolling body.
- **Pickers open in place.** A `BottomSheet` rendered inside another open sheet (a `Select`, a `DateTimeSheet`, a status list) does not stack a second sheet: it replaces the body with a back arrow, its title, and the parent's title as the subtitle. Back, the backdrop and Android back return to the form. `presentation="modal"` opts out for the rare sheet that must sit on top. A page can open its own picker (a field's Type on its edit page): earlier pages stay mounted underneath, and Back returns to them with their state.
- **Settings screens** (a workspace, project settings) show a summary first and edit in sheets: `ListGroup`/`ListRow` in `components/settings/SettingsList.tsx` (one card, hairline dividers, 48px rows, a `tone="add"` "+ New …" row last), each row opening an edit page of the sheet with Save in the footer and Delete as a quiet destructive button in the body, confirmed by a `ConfirmSheet` page. No inline add forms or Edit/Remove text links. Settings pages with inline values (Schedule, Account, Notifications, Data & backups) use the same groups: `GroupLabel` above, `GroupHint` below, `ListRow` with a `trailing` control (a bare `Field`, a time pill, a `size="sm"` `SegmentedControl`) and `SwitchRow`/`ListSwitch` for on/off, never the native `Switch`.
- **Create forms and details are grouped rows.** Quick add, the task and event details screens and a project's properties use the Settings groups too: a large bare title (and notes), then cards of rows with the label on the left and the value on the right (muted 13/500, a dot for a coloured value, a tint only when it carries meaning such as High priority). A multi-pick (labels, a multi-select field) is one summary row ("Design, Bug +1") that opens a page of `SheetOption`s; Repeat is one row that opens the presets as a page, with Custom as a card of rows under them (Every stepper, Unit, On day dots, Ends) (`RepeatRow`, `LabelsRow` and `CustomFieldsGroup` in `components/tasks/TaskMetaRows.tsx`, shared by Quick add and task details). On/off is a `SwitchRow`, a small choice a `size="sm"` `SegmentedControl`, short text an inline right-aligned `Field bare align="right"`. Quick add ends with a "More options" row that reveals the Auto-schedule card, Labels and Custom fields. The footer is a live summary of where the item lands and when, plus one primary button (Create, or Capture for the Inbox).
- **Desktop create dialog and task details.** `CreateDialogShell` and `CreateDialogFooter` in `app/_components/_ui/modal/entityModal.tsx` give the web add-item form the same anatomy: a kind chip in the header that switches the form in place (a typed title comes along), the title, notes whose toolbar shows only while you write in them (`RichTextEditor toolbar="focus"`), then the same cards as the phone, built from `ListGroup`, `ListRow`, `GroupLabel`, `GroupHint` and `ListSwitch` in `app/_components/_ui/groupedList.tsx`. Values use the row variants: `Select variant="row"` (with `values` for a multi-pick), `DatePicker`/`TimeField`/`DateTimeField variant="row"`, `ColorPicker variant="row"`, `RecurrenceEditor` (a Repeat row whose Custom rows join the same card, like the phone's Repeat page), `CustomFieldControl variant="row"`, and `CreateLabelInline`/`CreateCustomFieldInline variant="row"` as the card's last "+ New …" row. Wide dialogs put two cards side by side. The dialog is 720px wide (560px for a doc, sheet or workspace), as tall as its content, and sits near the top of the screen so "More options" grows it downward. The task details sidebar uses the same cards (Details, Dates, Schedule, Auto-schedule, Custom fields), and so do the calendar block and "Add to calendar" dialogs.

## Busy states

The animated Timely logo (`LogoSpinner`, `LogoLoader`) wherever a spinner would be, on both apps.
