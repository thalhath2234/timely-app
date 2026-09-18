# Timely design system

Visual source of truth for desktop web, Electron, and native Expo. Capability lives in `apps/web/FEATURES.md` and `PARITY.md`. This file covers how the product should look and feel.

Theme and accent are **account-wide** (`appearance` on `GET`/`PUT /config`). Changing them on one surface updates the other after refresh. Sidebar auto-hide is web-only.

---

## Product stance

Timely is a **private, single-user** time operating system: capture, schedule, focus, write, and export. The UI is dense, keyboard-capable on desktop, and one-handed on the phone. It should feel like a developer-grade tool (Linear, Raycast), not a playful consumer app and not a squeezed spreadsheet.

Three pillars:

1. **Precision dark UI** — layered slate surfaces, hairline borders, high-contrast type. Dark is the reference; light is a first-class inverse, not an afterthought.
2. **Kinetic feedback** — springs, press scale, and 100–180ms state changes. Actions feel instantaneous. Reduce Motion turns all of it off.
3. **Signal over decoration** — accent and semantic color mark *what matters now* (focus, overdue, complete). Everything else stays quiet.

Do not introduce neon gradients, glassmorphism, heavy drop shadows, or candy-colored chips. Do not invent team/sharing chrome.

---

## Surfaces

| Surface | Chrome | Density |
| --- | --- | --- |
| **Desktop web / Electron** | 68px icon rail (Today, Inbox, Calendar, Tasks, Projects, Docs, Sheets, Report, Notifications, Settings). Optional auto-hide: reveal when the pointer is within 12px of the left edge. | Compact rows 32–40px. Primary buttons ~32px. Command palette, overlays, right-click menus. |
| **Native (Expo)** | Tabs: Home, Calendar, Tasks, Search, Files. Settings lives on Home. Floating pill tab bar + squircle FAB. Sheets and long-press instead of hover. | Thumb-zone. Primary buttons and fields 52px. Cards 18px radius. Titles 28 / 18. |

Same objects, same labels, same accent. Do not copy desktop chrome onto the phone, and do not flatten mobile into Expo template defaults.

---

## Color

### Accent (account)

Default brand violet is `#6E56CF`. Buttons, focus rings, active nav, and highlights follow the chosen accent.

| Preset | Hex |
| --- | --- |
| Violet (default) | `#6E56CF` |
| Indigo | `#3E63DD` |
| Blue | `#0090FF` |
| Teal | `#12A594` |
| Green | `#30A66D` |
| Orange | `#F76808` |
| Red | `#E5484D` |
| Pink | `#E93D82` |

Custom hex is allowed. On web, a custom accent remaps `--primary`, `--ring`, `--accent`, and sidebar primary via OKLCH hue/chroma. On native, the hex is mixed toward white (dark) or black (light) for primary, with a contrasting foreground.

### Dark (reference)

Matches `apps/web/app/globals.css` `.dark` and `apps/mobile/lib/theme.ts` `darkNeutral`.

| Token | Hex | Use |
| --- | --- | --- |
| Background / canvas | `#111319` | App floor, page background |
| Sidebar / deepest | `#0c0e14` | Desktop rail, auth shell |
| Card | `#191b22` web / `#1d1f26` native | Panels, list substrates |
| Popover / elevated | `#191b22` web / `#282a30` native | Menus, sheets, overlays |
| Secondary / muted fill | `#1d1f26` / `#33343b` | Hover, chips, tracks |
| Foreground | `#e2e2eb` | Titles, primary copy |
| Muted foreground | `#908fa0` | Meta, placeholders, inactive icons |
| Border | `rgb(255 255 255 / 8%)` | Hairline structure |
| Input | `rgb(255 255 255 / 12%)` | Field stroke |
| Default primary (CSS dark) | `#c0c1ff` | Lavender on dark when accent is default |
| On-primary | `#1000a9` | Text on filled primary (web CSS default) |
| Success | `#4edea3` | Complete, on-schedule |
| Warning | `#ffb95f` | Upcoming, medium risk |
| Destructive | `#ffb4ab` | Overdue, delete, errors |
| Destructive container | `#93000a` | Destructive fill |

Auth pages always render the dark shell (`#0c0e14` / `#e2e2eb`) regardless of the account theme.

### Light

| Token | Web (`:root`) | Native |
| --- | --- | --- |
| Background | `oklch(0.985 0.002 264)` | `#f4f4f8` |
| Foreground | `oklch(0.22 0.02 270)` | `#1b1c24` |
| Card | `#ffffff` | `#ffffff` |
| Muted | `oklch(0.955 0.005 270)` | `#ececf3` |
| Muted foreground | `oklch(0.52 0.015 270)` | `#5c5c6b` |
| Border | `oklch(0.912 0.006 270)` | `rgba(27,28,36,0.10)` |
| Default primary | `oklch(0.51 0.23 277)` | `#6657d9` |
| Success | `oklch(0.6 0.13 160)` | `#0f8f66` |
| Warning | `oklch(0.72 0.15 70)` | `#ca8100` |
| Destructive | `oklch(0.577 0.215 27)` | `#c63f35` |

### Semantic (do not restyle)

| Meaning | Color |
| --- | --- |
| Priority Urgent | `#E5484D` |
| Priority High | `#F76808` |
| Priority Medium | `#FFB224` |
| Priority Low | `#889096` |
| Unstaged / no color | `#889096` |

Workspace / project / stage / event colors come from the entity palette (or a user hex):

`#30A66D` `#6E56CF` `#FFB224` `#0090FF` `#E93D82` `#00A2C7` `#F76808` `#AB4ABA` `#3E63DD` `#12A594` `#99D52A` `#E5484D`

Mention chips in rich text:

| Kind | Tint |
| --- | --- |
| Doc | cool blue (`oklch(0.62 0.16 255)`) |
| Sheet | green (`oklch(0.6 0.15 155)`) |
| Task | amber (`oklch(0.65 0.16 45)`) |
| Project | violet (`oklch(0.6 0.17 300)`) |

Status badges: 12% fill of the semantic color, matching text, 25% border. Completed uses success green; paused / in-review uses warning; overdue / blocking uses destructive.

---

## Typography

**UI sans:** Inter (loaded as `--font-geist-sans` on web). Open apertures, tight tracking on headlines.

**Data mono:** JetBrains Mono for durations (`15m`), clock times, sheet headers, shortcuts, formula bar, code. Always `font-variant-numeric: tabular-nums` on live counters so layouts do not jitter.

| Role | Size | Weight | Tracking | Notes |
| --- | --- | --- | --- | --- |
| Display / mobile large title | 28px | 700 | −0.4px | Native `MobileHeader` large |
| Page title (desktop) | 24–36px | 600–700 | −0.02 to −0.03em | |
| Section title | 18–20px | 600 | −0.015em | Native compact header 18 / 600 |
| Body | 14–16px | 400 | 0 | Native fields 16px (no iOS zoom) |
| Compact body / list | 13–15px | 400–500 | 0 | Native list title 15 |
| Label / tab | 11–13px | 500–600 | +0.01em | Native tab 11 / 500 |
| Caps section | 12px | 600 | +0.6px | Native `SectionLabel`, uppercase |
| Code / metric | 12–13px | 400–500 | 0 to −0.01em | JetBrains Mono |

Copy is English, locale-aware dates, no translation catalog. Tone: short, literal, no marketing flourish inside the app. Empty and offline states tell the truth (“Offline · showing saved data…”).

---

## Shape, space, elevation

### Radius

| Token | Desktop | Native |
| --- | --- | --- |
| Base | `--radius: 0.75rem` (12px) | Cards 18px |
| Controls | 8–12px (`rounded-lg`) | Fields / primary 16px, icon buttons 14px |
| Pills | full | Chips full (`999`) |
| FAB / tab bar | — | 22px squircle (60×60 FAB, floating tab bar) |
| Checkboxes | 3–4px square (desktop) | Circular 20px hit target (native) |

### Spacing

4px rhythm. Common steps: 4, 8, 12, 16, 20, 24, 32.

- Desktop canvas gutters ~16–24px; sidebar 68px; inspector ~320px when open.
- Native outer margin 16px; tab bar inset 12px horizontal, 8px bottom; FAB 18px from the right, 12px above the tab bar.
- Card padding 12–16px. List row height 32px compact / 40px default (desktop), larger tap rows on native.

### Elevation

Depth is **tone + 1px border**, not fuzzy shadows.

- Resting card: surface + `1px` border at 8% white (dark) or 10% black (light).
- Hover: one step up the surface ladder (`#191b22` → `#282a30` on dark).
- Overlay: `bg-black/70` scrim; panel `surface` + hairline; optional `0 16px 32px -8px rgba(0,0,0,0.65)`.
- Native tab bar: 12 elevation / `shadowOpacity 0.28`, radius 22.
- Focus ring (web): `2px solid var(--ring)`, offset 2px. Kinetic indigo/violet, never a browser default.

---

## Layout

### Desktop shell

```
[ 68px rail ][ fluid canvas ]
```

Rail: primary + button, search, divider, destinations, settings/logout at the bottom. Active destination uses primary. Auto-hide slides the rail with `springSnappy`.

Canvas: page fade on route change (`opacity` + 8px rise, 280ms). Overlays (add item, search, task detail, confirm) sit above the shell.

### Native shell

```
[ large title / back ]
[ content ]
[ squircle FAB ]
[ floating pill tabs ]
```

Home is Today (focus, agenda, inbox, shutdown). Inbox and Notifications are one tap from Home. Search is a tab, not ⌘K. Docs and Sheets share Files.

---

## Components

### Buttons

- **Primary:** accent fill, contrasting label, hover `primary/90`, tap `scale(0.98)` (desktop) / spring scale (native). Desktop height ~32px; native 52× stretch, 16px / 700.
- **Ghost / secondary:** transparent or card fill, 1px border, muted → foreground on hover.
- **Destructive:** destructive color, confirm dialog before delete of workspace / project / doc.
- **Icon:** 32–40px hit target. Native header icons 40×40 on card fill, radius 14.

### Fields

Desktop: 34px, recessed fill (`#0c0e14` on dark), 1px border, ring on focus. Native: min 52px, radius 16, 16px type. Labels sit above; placeholders use muted foreground.

### Cards & rows

- Task / project cards: left 3px color bar (entity or priority), title, mono time, optional checkbox.
- Selected desktop row: inset 2px primary bar + hover fill.
- Native cards: radius 18, 16px padding, 1px border.

### Chips

Filter and taxonomy chips. Inactive: card + border + muted text. Active without a color: primary fill. Active with a color: tinted fill + 8px color dot.

### Navigation

- Desktop rail icons (Lucide), 20px.
- Native tabs 20px, active = accent, inactive = muted. Hide FAB on Search and Settings.
- Segmented view switchers (Day / Week / Month / Agenda, List / Board): pill track, active segment elevated.

### Overlays

- **Command / search (web):** centered, max ~640px, popover surface, 48px unbordered input, Esc to close.
- **Add item / Quick Add:** type first (Inbox, Task, Reminder, Event, Doc, Sheet). Work | Reminder toggle before duration. Native is a spring sheet.
- **Confirm:** title, danger confirm label, pending “Signing out…” style copy.
- **Toast:** enter from below, exit sideways. Auto-schedule uses a floating indicator + undo.

### Calendar

Hour grid (day/week), month cells, agenda groups. Now-line is a 1.5–2px accent rule with a 6px dot. Reminders are short chips and do not occupy busy time. Waiting-for-slot is a ranked rail (desktop) or list (native). Engine skip reasons are plain language, never raw `tsk_` ids.

### Editors

Docs: Notion-like, slash `/`, `@` mentions, VS Code Dark+ code blocks even in light mode. Sheets: formula bar, JetBrains Mono cells, ribbon (skip Print on native; use share). Task descriptions use the compact editor with explicit Save.

---

## Motion

Shared springs (web `motion.tsx`, native `lib/motion.ts`):

| Token | Values |
| --- | --- |
| `easeOut` | cubic-bezier(0.22, 1, 0.36, 1) |
| `springSoft` | stiffness 420, damping 32, mass 0.85 |
| `springSnappy` | stiffness 520, damping 36, mass 0.7 |
| Overlay | 180ms |
| Page | 280ms |
| List stagger | 35–40ms per item, cap ~8 |

Desktop: View Transitions for scrim / panel / popover; page fade on pathname; hover lift −2px; tap 0.98.

Native: stack `ios_from_right` / `slide_from_right`; tab cross-fade; Reanimated sheet slide; FAB and row press scale; list `FadeInDown`.

**Reduce Motion** (`prefers-reduced-motion` / `AccessibilityInfo`): duration ≈ 0, no springs, stack `animation: "none"`. Never ship a motion-only affordance.

---

## Iconography

Lucide (web `lucide-react`, native `lucide-react-native`). Outline, 20–22px in chrome, 16px inline. No filled icons except an active tab or a completed checkbox. Do not mix icon sets.

---

## Implementation map

| Concern | Web | Native |
| --- | --- | --- |
| Tokens | `apps/web/app/globals.css`, `app/utils/theme.ts` | `apps/mobile/lib/theme.ts` |
| Motion | `app/_components/_ui/motion.tsx` | `lib/motion.ts` |
| Entity / priority color | `app/utils/entityColor.ts`, `priority.ts` | same contracts in mobile `lib/` |
| Shell | `app/_components/_layout/appShell.tsx`, `sidebar.tsx` | `(tabs)/_layout.tsx`, `Screen.tsx`, `MobileHeader.tsx` |
| Primitives | Tailwind + shadcn-style CSS variables | `components/ui/primitives.tsx` |

When adding a screen: reuse these tokens and chrome. Do not introduce a third palette, a new typeface, or a one-off radius scale.
