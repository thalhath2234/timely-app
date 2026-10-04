# Building with Timely

Timely is a personal planner (tasks, projects, calendar, docs, sheets, an AI assistant). These are the
real components of its web app, styled with Tailwind 4 utility classes over CSS-variable tokens.

## Setup: always wrap in `TimelyProvider`

Every component must sit inside `TimelyProvider`. It supplies the React Query client the data-bound
components need (without it they throw), the light/dark token scope, the Inter font and page colours,
and a mock Timely API serving a coherent sample workspace (Maya Chen, a product designer: projects
"Onboarding Redesign", "Design System v2", "Portfolio Refresh"; tasks, events this week, docs, sheets,
chats, notifications), so data-bound components such as `TasksTable`, `TodayDashboard`, `KanbanView`,
`AgentSettings` and `Sidebar` render populated with no props or fetching.

```jsx
const { TimelyProvider, AppShell, TasksTable } = window.Timely;
<TimelyProvider theme="light">          {/* or "dark" */}
  <AppShell><TasksTable /></AppShell>
</TimelyProvider>
```

- `theme="dark"` switches every token (it also puts `dark` on `<html>`, because dialogs, menus and
  popovers portal to `document.body`).
- `seed={[[queryKey, data]]}` pre-fills one provider's query cache, e.g. `seed={[[["tasks"], []]]}` for
  an empty task list. Use it for region-specific data; it is scoped to that provider.
- `api={{ "GET /tasks": [...] }}` overrides mock routes, but page-wide (last mounted provider wins).
- `animations={false}` jumps every animation to its end state (for static screenshots only).
- Navigation is a no-op outside the app; `Sidebar`/`AppShell` highlight the route in
  `window.__TIMELY_PATHNAME__` (default `"/today"`, e.g. `"/projects"`, `"/calendar"`).

## Styling idiom: Tailwind utilities on semantic tokens

Style your own layout glue with the app's semantic utility classes, never raw colours. The stylesheet
is precompiled from the app, so **only classes the app already uses exist**: stick to the vocabulary
below, and use inline `style={{}}` for anything else (fixed pixel sizes, unusual grids). An invented
class such as `w-[1100px]` or `bg-indigo-500` silently does nothing.

| Purpose | Classes |
|---|---|
| Surfaces | `bg-background` (page), `bg-card`, `bg-popover`, `bg-muted`, `bg-accent`, `bg-sidebar` |
| Text | `text-foreground`, `text-muted-foreground`, `text-primary`, `text-destructive`, `text-success`, `text-warning` |
| Brand / actions | `bg-primary text-primary-foreground` (primary button), `bg-secondary text-secondary-foreground`, `bg-destructive` |
| Lines | `border border-border`, `border-dashed`, `ring-ring` |
| Shape | `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full`, `shadow-sm`, `shadow-lg` |
| Type | `text-xs`, `text-sm` (body default), `text-base`, `text-lg`, `text-xl`, `text-2xl`, `font-medium`, `font-semibold`, `font-mono`, `tabular-nums` |
| Layout | `flex`, `grid`, `gap-1`…`gap-6`, `p-2`…`p-6`, `px-3 py-1.5`, `items-center`, `justify-between`, `min-w-0`, `flex-1`, `truncate` |

The same tokens are CSS variables (`var(--background)`, `var(--primary)`, `var(--border)`,
`var(--muted-foreground)`, `var(--radius)` …) for inline styles. The visual language is calm and
dense: `text-sm` body, muted secondary text, 1px `border-border` hairlines, `rounded-lg`/`rounded-xl`
cards, one violet primary accent.

## Where the truth lives

- `styles.css` → `_ds_bundle.css`: the compiled stylesheet. Search it before using a class you
  haven't seen in a component's `.prompt.md`.
- `components/<group>/<Name>/<Name>.prompt.md` and `.d.ts`: each component's props and
  verified usage examples. Groups: `ui` (primitives: Select, DatePicker, ColorPicker, EmptyState,
  ConfirmDialog…), `modal` (EntityModalShell + ModalMain/ModalSidebar/PropertyRow), `tasks`,
  `calendarview`, `today`, `chat`, `settings`, `docs`, `sheets`, `editor`, `projects`, `layout`
  (AppShell, Sidebar), `landing` + `scenes` (marketing site, dark `.landing` theme of its own).

## Example: a page section in Timely's idiom

```jsx
const { TimelyProvider, EmptyState } = window.Timely;
<TimelyProvider>
  <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold text-foreground">Inbox</h2>
      <button className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">New task</button>
    </div>
    <EmptyState title="Inbox is empty"
      description="Press C to capture a title, or N anywhere to create a full task." />
  </section>
</TimelyProvider>
```

`EmptyState` also takes `icon` (a lucide-style icon component) and `action` (a node).
