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
| Diagram (Mermaid) | a ```` ```mermaid ```` code block; Timely draws it under the source, GitHub and Obsidian draw it too |
| Divider | `---` |
| Table | GFM table; the first row is the header; `\|` is a literal pipe |
| Image | `![alt](src "title")` |
| Formula (inline) | `$E = mc^2$` (TeX, drawn with KaTeX; a literal `$` is written `\$`) |
| Equation (block) | `$$` on its own line, TeX lines, `$$`; `$$x$$` on one line is read too |
| Callout | `> [!NOTE]`, then the body as quoted lines; `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` and any other word Obsidian allows; `> [!NOTE] Title` keeps a title |
| Footnote | `[^1]` in the text, `[^1]: the note` where the file has it (continuation lines indented four spaces); `[^x]` without a definition stays text |
| Properties (frontmatter) | `---` / `key: value` lines / `---` at the very top, kept verbatim; it can only be the first block |
| Wiki link | `[[Page title]]`, `[[Page title\|alias]]`, `![[Page title]]` (embed); clicking opens the doc with that title |
| Map | a ```` ```geojson ```` or ```` ```topojson ```` code block, drawn as an outline (GitHub draws it over a street map) |
| 3D model | a ```` ```stl ```` code block (ASCII STL), drawn with three.js; each `solid <name>` is a part, and a `#rrggbb` word in the name colors it (`solid head #f2c6a0`). Other STL readers ignore the color. Normals are recomputed, so `facet normal 0 0 0` is fine |
| @mention | `[@Label](timely://task/<id>)` (also project, doc, sheet) |
| Subpage link | `[Label](timely://doc/<id>)` |

Characters that Markdown would read as formatting (`*`, `[`, `` ` ``, a
leading `#` or `-`, ...) are backslash-escaped on export and unescaped on
import.

A divider as the very first block is written `***` so it is not read as the
start of frontmatter. The callout marker is exported on a line of its own
with a blank quoted line after it, which GitHub and Obsidian both read; a
hand-written `> [!NOTE]` followed directly by text is read too.

The agent's MCP tools (`create_doc`, `update_doc`, `append_to_doc`,
`get_doc`) use the same syntax, so everything in this table can be written
and read by the assistant. `add_3d_model` builds an `stl` block from simple
parts (sphere, box, cylinder, cone, capsule, each with a color), so the
assistant does not write triangles by hand.

Not representable, so the editor does not offer them: merged table cells and
header columns. Column widths set by dragging are not exported. Raw HTML in
an imported file (other than `<u>`, `<mark>` and `<br>`) is kept as visible
text.
