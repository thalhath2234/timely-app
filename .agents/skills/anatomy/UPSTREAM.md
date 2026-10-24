# Vendored anatomy

Copied verbatim from https://github.com/wheresryan22/anatomy/tree/1482e8469b0a9e0d8cc18ea2740a01423d29ae80 (MIT, see LICENSE).
Update with `make anatomy-sync`; never edit these files by hand.

Left out: the built example pages and PDFs (`examples/**/*.html`, `*.pdf`, about 24 MB; rebuild one with
`node examples/<name>/build.mjs [--light]`), and `.github/`, `evals/`, `agents/` and the contributor docs.

Its checks find Chrome in the usual install paths only. In a cloud session, run them with
`CHROME_PATH=/opt/pw-browsers/chromium`.
