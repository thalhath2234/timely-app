# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `thalhath2234/timely-app`.
Use `gh` from the repo root for issue operations.

## Conventions

- Create: `gh issue create --title "..." --body-file <file>`
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --body-file <file>`
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Resolve a bare `#number` as a PR first with `gh pr view <number>`,
then fall back to `gh issue view <number>`.

## Pull requests as a triage surface

PRs as a request surface: no.

## Skill terms

- "Publish to the issue tracker" means create a GitHub issue.
- "Fetch the relevant ticket" means read it with `gh issue view <number> --comments`.
