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

Phone `Select` in `primitives.tsx`: field-looking trigger (`label` optional) that opens a bottom sheet of `SheetOption`s.

## Date and time

Always Timely's own picker, never `<input type="date|time">` and never a typed "HH:mm".

- Web: `DatePicker`, `DateField`, `TimeField`, `DateTimeField` in `app/_components/_ui/datePicker.tsx`; triggers use `controlClass`.
- Phone: `DateField` and `TimeField` in `components/ui/DateTimeField.tsx` (a field row that opens `DateTimeSheet`), or `DateTimeSheet` directly for custom triggers.

## Segmented control

Switching views or modes (List/Kanban, Day/Week/Month, All/Docs/Sheets, System/Light/Dark). A muted track with the active segment raised on a card, not filled with the accent. Web `app/_components/_ui/segmentedControl.tsx` (sm 28 / md 32), phone `components/ui/SegmentedControl.tsx`.

## Page header

Web `app/_components/_ui/pageHeader.tsx`: 24px semibold title, optional `PageBadge` count, one-line description, actions on the right as `md` buttons with the primary last, `px-6 pt-5 pb-4`.

Phone `MobileHeader`: tab roots (Today, Tasks, Calendar, Search, Files) use the large 28px title; every pushed screen (`back`) uses the compact 17px title. `large` defaults to `!back`.

## Busy states

The animated Timely logo (`LogoSpinner`, `LogoLoader`) wherever a spinner would be, on both apps.
