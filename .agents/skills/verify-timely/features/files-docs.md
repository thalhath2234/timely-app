# Files: docs

A user creates a doc from Files, gives it a title, and writes in a rich-text editor (slash commands, mentions, checklists). The doc saves as they type, shows up in the Files library and side list, and reopens with the same content.

## Sub-features

- `docs-new`: `New doc`, then the `New` menu, then `New doc` (menu item). A doc `Untitled` is created and its page opens at `/files/doc_<id>`.
- `docs-edit`: the title textbox (named `Untitled` while empty) and the body editor save automatically. The word count updates.
- `docs-persist`: after a reload, the title is in the side list link and the body text is in the editor.
- `docs-library`: `/files` lists Recent files with a Preview panel (`Open` link) and Library counts (Docs N).
- `docs-sheets`, `docs-import`, `docs-templates`: New sheet, Import (Markdown/CSV) and templates. Not driven yet.

## How to get to it (user POV)

- Sidebar `Files` (`/files`), then `New doc` in the header (opens the `New` menu) or in the empty state.
- Inside a doc, the side panel's `New doc or sheet` button.
- Old `/docs/<id>` links redirect to `/files/<id>`.

## Driving it with browser.mjs

Preconditions:

- `$V doctor` reports OK, and there is a fresh account from `$B signup-onboard` (no files: "Nothing here yet").
- `T=$(date +%H%M%S)`.

Steps:

- **Open Files.** Run `$B open /files`, then `$B wait --text "Nothing here yet" --timeout 60000`.
- **New doc.** Run `$B click --role button --name "New doc" --first`. The menu `New` opens. Run `$B click --role menuitem --name "New doc"`, then `$B wait --url-includes /files/doc_ --timeout 60000`. The tab `Untitled` and the toolbar `Formatting` are visible. The first compile of the doc route can take 10 s or more.
- **Edit.** Run `$B fill --role textbox --name Untitled --exact --value "Trip plan $T"`, then `$B fill --css ".ProseMirror" --value "Book the train $T"`. The word count changes from `0 words`.
- **Persist.** Wait about 2 s for autosave, then reload. Run `$B open "<the /files/doc_ URL from $B url>"`, then `$B wait --text "Book the train $T" --timeout 60000` and `$B expect --role link --name "Trip plan $T"` (side list).
- **Second view.** Run `$B api GET /docs --path $RUN/docs-persist.api.json`. The doc has `"title":"Trip plan $T"` and its `plainText` contains `Book the train $T`. Run `$B screenshot --path $RUN/docs-persist.png`.
- **Library.** Run `$B open /files`. The Recent grid has a row starting with `Trip plan $T`, and `Docs 1` shows in Library.

## Gotchas

- The header `New doc` opens a menu. It does not create a doc directly. The empty-state `New doc` button has the same name, so use `--first` or scope it.
- After choosing the menu item, the URL changes only once the doc route has compiled. Wait on `--url-includes /files/doc_`, not on a fixed sleep.
- The body editor has no accessible name. `--css ".ProseMirror"` is the only stable handle. `fill` replaces all body content.
- Saving is debounced. Reading `/docs` straight after typing can return the previous content.
