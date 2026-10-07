# Docs and Markdown

A Timely doc is stored as Tiptap (ProseMirror) JSON in `documents.content`.
Markdown is a second, lossless view of the same doc:

- **Export** (doc header download button, mobile "Export Markdown", agent
  tools): `apps/api/internal/richtext/tomarkdown.go`.
- **Import** (Import Markdown on web and mobile): `packages/contract/src/markdown.ts`.
- **Agent writes** (Markdown from the assistant): `apps/api/internal/richtext/frommarkdown.go`.

Exporting a doc and importing the file gives the same doc back.
`apps/api/internal/richtext/testdata/parity.{json,md}` pins this for the Go
and TypeScript sides (`make test-api`, `make test-markdown-parity`).

| In the editor | In Markdown |
| --- | --- |
| Heading 1-6 | `#` ... `######` |
| Bold, italic, strike, inline code | `**b**`, `*i*`, `~~s~~`, `` `c` `` |
| Highlight | `==text==` |
| Underline | `<u>text</u>` |
| Link | `[text](url)` |
| Line break (Shift+Enter) | `\` at line end; `<br>` inside a table cell |
| Empty paragraph between blocks | a line with only `<br>` |
| Bullet, numbered (any start), task lists, nested | `-`, `3.`, `- [x]`, indented |
| Quote | `>` (may hold lists and code) |
| Code block with language | fenced block, fence grows past any backticks inside |
| Divider | `---` |
| Table | GFM table; the first row is the header; `\|` is a literal pipe |
| Image | `![alt](src "title")` |
| @mention | `[@Label](timely://task/<id>)` (also project, doc, sheet) |
| Subpage link | `[Label](timely://doc/<id>)` |

Characters that Markdown would read as formatting (`*`, `[`, `` ` ``, a
leading `#` or `-`, ...) are backslash-escaped on export and unescaped on
import.

Not representable, so the editor does not offer them: merged table cells and
header columns. Column widths set by dragging are not exported. Raw HTML in
an imported file (other than `<u>`, `<mark>` and `<br>`) is kept as visible
text.
