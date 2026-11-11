# Phase 3 review of Hermes' bundled skills

- Date: 2026-11-11. Branch `feature/hermes-phase3`. Package `worker-skills-backup` (`docs/plans/2026-11-11-phase3-work-packages.md`).
- Copy: Hermes v0.23.0 (`apps/agent/hermes`), 44 bundled skills under `skills/`, 142 optional skills under `optional-skills/`.
- Records: `apps/agent/.hermes-sync/policy/skills-reviewed.json` (default on/off and a reason for every bundled skill; offered or not for every optional one) and `apps/agent/.hermes-sync/policy/skills-denied.json` (generated). Plan sections 9.1-9.3, 9b.5.

## How the review was done

Every bundled `SKILL.md` was read in full, line by line, and the description of every optional skill Timely offered after phase 1 (84) was read, with the body of each one whose description raised a question (`property-listings`, `osint-investigation`, `mcporter`, `obliteratus`, `scrapling`, `live-dashboard`, `dynamic-workflow`, `research-paper-writing`). The questions asked of each skill:

1. Does its core job work in a phase 3 chat? A chat has Timely's own tools, `todo`, `skills`, `memory`, past-chat search and web search and extract. Terminal, file and browser tools arrive in phase 5 and ask for approval in chat; `clarify` and delegation arrive in phase 4; image generation stays blocked.
2. Does it point the agent at anything Timely refuses: Hermes itself (`hermes <command>`, `~/.hermes`), messaging (decision 6), kanban, the host's own logins and credential files, routing around Timely's web gate?
3. Does it fit a personal planner (tasks, calendar, notes, research, writing)?

A bundled skill is **on by default** only when its core job works in a phase 3 chat and the answer to 2 is no. A skill whose core job needs terminal, file or browser tools is **off until phase 5** re-reviews it. Off is a default, not a ban: the person can turn any reviewed, not-denied skill on in Settings. A **denied** skill (below) is left out of every account's seed tree, so nobody can turn it on.

## Totals

| | Count |
|---|---|
| Bundled skills | 44 |
| on by default | 10 (was 26 after phase 1) |
| off by default | 34, of them 14 denied |
| Optional skills | 142 |
| offered in Settings | 78 (was 84) |
| denied optional skills | 52 (none offered) |

## Defaults changed in this review

| Skill | Was | Now | Reason |
|---|---|---|---|
| `creative/ascii-video` | on | off | the whole pipeline is a Python + NumPy + ffmpeg script run in the terminal; nothing of it works in a phase 3 chat; revisit when terminal and file tools ship (phase 5, approve in chat) |
| `creative/baoyu-infographic` | on | off | its result is an image from image_generate, which Timely blocks (phase later); every step writes files and it asks through clarify (blocked in chat until phase 4) |
| `creative/manim-video` | on | off | renders with Manim, LaTeX and ffmpeg in the terminal (pip install manim); revisit when terminal and file tools ship (phase 5, approve in chat) |
| `devops/sdlc-review` | on | off | denied (needs-toolset:kanban): runs only as a Hermes kanban review worker; every kanban tool is never offered |
| `media/youtube-content` | on | off | its setup runs inside a Hermes source checkout (source ./activate, pm.sync_venv): Hermes' own package manager, which the worker does not have; then terminal |
| `note-taking/obsidian` | on | off | resolves the vault from $HERMES_HOME/.env or ~/Documents (the account home in a worker), so it cannot find the person's vault; all steps are file tools; Timely docs are the notes store; revisit when terminal and file tools ship (phase 5, approve in chat) |
| `productivity/microsoft-office` | on | off | every operation runs Python helpers in the terminal (and may pip install into ~/.cache); revisit when terminal and file tools ship (phase 5, approve in chat) |
| `productivity/pdf` | on | off | every operation runs Python helpers in the terminal (pypdf, reportlab, pdfplumber); revisit when terminal and file tools ship (phase 5, approve in chat) |
| `research/grounded-citations` | on | off | denied (home-path): every step runs a ledger script from ~/.hermes/skills through the terminal; in a worker that path does not exist |
| `software-development/codebase-inspection` | on | off | its first step is pip install --break-system-packages through the terminal; repository metrics are outside a phase 3 chat |
| `software-development/dogfood` | on | off | every step uses browser_exec (approve, phase 5) and writes report files; revisit when terminal and file tools ship (phase 5, approve in chat) |
| `software-development/requesting-code-review` | on | off | git, linters and tests in the terminal, reviewer subagents (phase 4), and it ends with git add -A and a commit; revisit when terminal and file tools ship (phase 5, approve in chat) |
| `software-development/simplify-code` | on | off | git diff, four delegate_task reviewers (phase 4) and file edits; revisit when terminal and file tools ship (phase 5, approve in chat) |
| `software-development/spike` | on | off | builds throwaway code with terminal, write_file and delegate_task; revisit when terminal and file tools ship (phase 5, approve in chat) |
| `software-development/systematic-debugging` | on | off | its required first phase is a reproduction loop run in the terminal with read_file/search_files; revisit when terminal and file tools ship (phase 5, approve in chat) |
| `software-development/test-driven-development` | on | off | every cycle runs tests in the terminal and it tells the agent to delete code written before a test; revisit when terminal and file tools ship (phase 5, approve in chat) |
| `autonomous-ai-agents/antigravity-cli` (optional) | offered | not offered | drives another agent CLI with its own login and sandbox, like codex and claude-code (off); CLI providers reach Timely through the Go gateway |
| `mcp/mcporter` (optional) | offered | not offered | lists, authorizes and calls MCP servers from the terminal, around Timely's per-account MCP settings and sign-ins |
| `mlops/obliteratus` (optional) | offered | not offered | removes refusal behaviour from model weights; outside what a personal planner offers |
| `productivity/property-listings` (optional) | offered | not offered | a recipe for Hermes desktop transcript cards, which Timely's apps do not render |
| `research/osint-investigation` (optional) | offered | not offered | cross-references people through property, court and identity records; investigating individuals is outside what Timely offers |
| `research/scrapling` (optional) | offered | not offered | stealth browsing and Cloudflare bypass, which would route around Timely's web gate and sites' access controls |

## Every bundled skill

| Skill | Default | Reason | What it asks the agent to do |
|---|---|---|---|
| `apple/apple-notes` | off | macOS only (memo CLI through terminal); Timely ships no macOS build, and Timely's own docs are the notes store | Create, search, edit, move and export Apple Notes with the memo CLI. |
| `apple/apple-reminders` | off | macOS only (remindctl through terminal); Timely's own tasks and reminders cover this | Add, list, complete and delete Apple Reminders with remindctl; points agent alerts at the cronjob tool. |
| `apple/findmy` | off, denied | denied (home-path): screenshots into ~/.hermes/cache; macOS only; tracks device and AirTag locations through UI automation and a cron loop | Open FindMy with AppleScript or peekaboo, screenshot it, read locations with vision_analyze, poll with a cronjob. |
| `apple/imessage` | off | messaging (decision 6): sends iMessage/SMS; macOS only; needs Full Disk Access for the terminal | Read and send iMessages and SMS with the imsg CLI after confirming recipient and text. |
| `autonomous-ai-agents/claude-code` | off, denied | denied (home-path): writes to ~/.hermes/cache; drives another agent CLI in tmux with the host's own Claude login; CLI providers reach Timely through the Go gateway (phase 4) | Install and run Claude Code in print or tmux mode, answer its permission dialogs, review PRs, run parallel instances. |
| `autonomous-ai-agents/codex` | off, denied | denied (hermes-cli:auth, home-path): Hermes-managed Codex OAuth in ~/.hermes/auth.json; drives another agent CLI, recommends sandbox-bypass flags | Run the Codex CLI in a PTY for features, PR reviews and parallel worktree fixes, then push and open PRs. |
| `autonomous-ai-agents/computer-use` | off, denied | denied (hermes-cli, home-path): needs computer_use, which tools.yaml blocks; tells the person to run hermes computer-use doctor | Drive the desktop through computer_use: capture, click by element index, escalate to foreground input. |
| `autonomous-ai-agents/hermes-agent` | off, denied | denied (Hermes-self): operating Hermes itself (hermes setup/config/gateway/cron/kanban, ~/.hermes paths, spawning hermes in tmux); essential in Hermes, so it is left out of the seed tree | Answer questions about Hermes, spawn more Hermes processes, edit Hermes config and skins with the hermes CLI. |
| `creative/architecture-diagram` | on | text in, text out: the HTML/SVG diagram can come back in the reply; saving a file waits for phase 5 file tools (approve); no outside calls, no Hermes paths | Write a dark-themed standalone HTML file with an inline SVG architecture diagram from a template. |
| `creative/ascii-video` | off | the whole pipeline is a Python + NumPy + ffmpeg script run in the terminal; nothing of it works in a phase 3 chat; revisit when terminal and file tools ship (phase 5, approve in chat) | Write and run a Python pipeline that renders video, audio or generative input as coloured ASCII MP4/GIF. |
| `creative/baoyu-infographic` | off | its result is an image from image_generate, which Timely blocks (phase later); every step writes files and it asks through clarify (blocked in chat until phase 4) | Analyse content, pick a layout and style, write prompt files and generate an infographic image. |
| `creative/claude-design` | on | design process and taste; the HTML artifact can come back in the reply until file tools ship (phase 5); its install pointer (hermes skills install design-md) is a mention, not a step | Scope a design brief, commit to a surface, produce variants as self-contained HTML, run a slop self-audit. |
| `creative/humanizer` | on | pure writing guidance on text the person pastes; file edits are optional and go through approval later | Find 34 AI-writing patterns in a text and rewrite it in a natural voice, with a self-audit pass. |
| `creative/manim-video` | off | renders with Manim, LaTeX and ffmpeg in the terminal (pip install manim); revisit when terminal and file tools ship (phase 5, approve in chat) | Plan, code and render 3Blue1Brown-style Manim animations and stitch them with ffmpeg. |
| `creative/p5js` | on | the deliverable is one self-contained HTML sketch that can come back in the reply; preview servers and headless export are terminal steps that wait for phase 5 approval | Write p5.js sketches (generative art, data viz, shaders) as single HTML files, with optional export scripts. |
| `creative/popular-web-designs` | on | design tokens read with skill_view; HTML comes back in the reply; the cloudflared-tunnel and browser verification steps need tools a chat does not have and are skipped | Load one of 54 brand design systems and generate HTML/CSS in that style. |
| `creative/songwriting-and-ai-music` | on | pure writing craft (lyrics, structure, Suno prompts); its install pointers are mentions | Write and adapt song lyrics and build Suno style prompts and metatags. |
| `devops/sdlc-review` | off, denied | denied (needs-toolset:kanban): runs only as a Hermes kanban review worker; every kanban tool is never offered | Review a kanban handoff with kanban_show, run checks, then kanban_complete, request changes or block. |
| `email/email-inbox-triage` | off | no mail connector in Timely (himalaya and google-workspace are off); sending mail is messaging (decision 6) | Triage a mailbox through a mail connector, calibrate on sent mail, draft replies, send only approved ones. |
| `email/himalaya` | off | messaging (decision 6): sends and deletes mail through the himalaya CLI; needs IMAP/SMTP credentials on the host and curl|sh install | Configure and use the himalaya CLI to read, send, move and delete email. |
| `media/youtube-content` | off | its setup runs inside a Hermes source checkout (source ./activate, pm.sync_venv): Hermes' own package manager, which the worker does not have; then terminal | Fetch a YouTube transcript with a helper script and turn it into summaries, chapters, threads or posts. |
| `note-taking/obsidian` | off | resolves the vault from $HERMES_HOME/.env or ~/Documents (the account home in a worker), so it cannot find the person's vault; all steps are file tools; Timely docs are the notes store; revisit when terminal and file tools ship (phase 5, approve in chat) | Read, search, create and patch Markdown notes in an Obsidian vault with file tools. |
| `productivity/document-to-action-items` | on | fits Timely: turns pasted or fetched documents into cited facts and proposed tasks, and asks before any write (Timely's proposal flow) | Extract cited obligations, deadlines and tasks from documents and propose them for approval. |
| `productivity/google-workspace` | off, denied | denied (hermes-cli:setup, home-path): Hermes-managed OAuth with tokens in ~/.hermes; asks the person for OAuth client secrets in chat; Gmail sending is messaging | Run a Google OAuth setup script, then read and change Gmail, Calendar, Drive, Contacts, Sheets and Docs. |
| `productivity/maps` | off, denied | denied (home-path): runs its script from ~/.hermes/skills; requires the terminal toolset; written for Telegram location pins | Geocode, find nearby places, route and look up time zones with an OpenStreetMap script. |
| `productivity/meeting-action-items` | on | fits Timely: decisions, owners and dates from notes the person shares; never invents owners or dates; drafts first and writes only what is approved | Turn meeting notes or transcripts into cited decisions and action items, then propose tickets for approval. |
| `productivity/microsoft-office` | off | every operation runs Python helpers in the terminal (and may pip install into ~/.cache); revisit when terminal and file tools ship (phase 5, approve in chat) | Create, read and edit .docx, .pptx and .xlsx files with python-docx, python-pptx and openpyxl helpers. |
| `productivity/pdf` | off | every operation runs Python helpers in the terminal (pypdf, reportlab, pdfplumber); revisit when terminal and file tools ship (phase 5, approve in chat) | Create, read, merge, split, fill, stamp and encrypt PDFs with helper scripts. |
| `productivity/product-price-monitor` | off, denied | denied (home-path): state under ~/.hermes/price-watches and Hermes cron jobs; the Timely override for the converted price bot is planned (plan 9.2) | Set up a price watch with a state file and a cronjob, then alert when a price or availability condition is met. |
| `productivity/teams-meeting-pipeline` | off, denied | denied (hermes-cli:teams-pipeline, hermes-cli:cron, session-platforms): operates a Hermes Teams/Graph pipeline; messaging (decision 6) | Operate the Teams meeting pipeline through hermes teams-pipeline commands and Graph subscriptions. |
| `productivity/weekly-review-planning` | on | fits Timely: a weekly review over tasks, calendar and notes; recommends first and changes only what is approved | Review the past week and the next one, clear inboxes, reconcile projects and build a capacity-aware plan. |
| `research/arxiv` | on | read-only research: web_extract reads abstracts and PDFs in a phase 3 chat; the curl API calls wait for terminal (phase 5) | Search arXiv and Semantic Scholar, read papers, build BibTeX entries. |
| `research/competitor-news-monitor` | off, denied | denied (home-path): state under ~/.hermes/competitor-watches and Hermes cron jobs; needs a Timely override like product-price-monitor | Set up a company watchlist with a state file and a cronjob, then send cited digests of material news. |
| `research/grounded-citations` | off, denied | denied (home-path): every step runs a ledger script from ~/.hermes/skills through the terminal; in a worker that path does not exist | Keep a citation ledger with a script, cite sources inline and verify the draft before delivering. |
| `social-media/xurl` | off | messaging (decision 6): posts, replies and DMs on X; installs with curl|bash; credentials in ~/.xurl | Post, search, like, follow and DM on X through the xurl CLI. |
| `software-development/codebase-inspection` | off | its first step is pip install --break-system-packages through the terminal; repository metrics are outside a phase 3 chat | Count lines of code by language with pygount. |
| `software-development/dogfood` | off | every step uses browser_exec (approve, phase 5) and writes report files; revisit when terminal and file tools ship (phase 5, approve in chat) | Run exploratory QA on a web app in a headless browser and write a bug report with screenshots. |
| `software-development/github` | off, denied | denied (home-path): references write to ~/.hermes paths and read tokens from the Hermes .env; gh CLI through the terminal (phase 5) | Work GitHub with the gh CLI: auth, issues, PRs, reviews, repos. |
| `software-development/requesting-code-review` | off | git, linters and tests in the terminal, reviewer subagents (phase 4), and it ends with git add -A and a commit; revisit when terminal and file tools ship (phase 5, approve in chat) | Scan a git diff, run tests and linters, have a subagent review it, auto-fix, then commit. |
| `software-development/simplify-code` | off | git diff, four delegate_task reviewers (phase 4) and file edits; revisit when terminal and file tools ship (phase 5, approve in chat) | Review recent code changes with four parallel reviewers and apply the safe fixes. |
| `software-development/spike` | off | builds throwaway code with terminal, write_file and delegate_task; revisit when terminal and file tools ship (phase 5, approve in chat) | Break an idea into feasibility spikes, build each as throwaway code and record a verdict. |
| `software-development/systematic-debugging` | off | its required first phase is a reproduction loop run in the terminal with read_file/search_files; revisit when terminal and file tools ship (phase 5, approve in chat) | Debug in four phases: reproduce, find patterns, test hypotheses, fix the root cause with a test. |
| `software-development/test-driven-development` | off | every cycle runs tests in the terminal and it tells the agent to delete code written before a test; revisit when terminal and file tools ship (phase 5, approve in chat) | Enforce red-green-refactor: write a failing test, watch it fail, write minimal code, refactor. |
| `web/blocked-page-recovery` | off, denied | denied (home-path): writes to ~/.hermes/cache; routes around paywalls and bot walls through third-party archives with curl, which would send URLs past Timely's web gate | Recover a blocked page through Wayback, archive.today, Jina Reader or an API pivot. |

## The deny list (plan 9.2)

`make hermes-tools-dump` writes `.hermes-sync/policy/skills-denied.json` from the copy: every bundled or optional skill folder that

- runs `hermes <command>` (Hermes operating itself), except three commands read and found to be mentions only: `hermes skills install` (a pointer to an optional skill), `hermes pm environment` (guarded by `command -v hermes`, with a plain-venv fallback) and `hermes chat -q` (described, never run);
- names a literal `~/.hermes` path (the host user's own Hermes home; `${HERMES_HOME:-~/.hermes}` follows the worker's home and does not count);
- requires, in its frontmatter, a toolset or tool Timely never offers (`phase: never` in `tools.yaml`, such as kanban), or is scoped to messaging-platform sessions (`session_platforms`);
- names a messaging or kanban tool that Hermes registers and `tools.yaml` never offers (`kanban_show`, `yb_send_dm`); words that only look like one (`matrix_rank`, `signal_quality`) or tools Hermes no longer has (`send_message`) do not count.

`seed.py` leaves every denied bundled skill out of the seed tree (a missing deny list seeds nothing), and `make hermes-sync-check` fails when the committed list is out of date, a denied bundled skill is `default: on`, or a denied optional skill is `offered: true`. Two bundled skills that were on after phase 1 are denied: `sdlc-review` (kanban) and `grounded-citations` (`~/.hermes/skills` script path).

| Skill | Reasons |
|---|---|
| `optional-skills/autonomous-ai-agents/agent-merge-conflict-arbiter` | hermes-cli:kanban, uses-tool:kanban_complete, uses-tool:kanban_create |
| `optional-skills/autonomous-ai-agents/blackbox` | home-path |
| `optional-skills/autonomous-ai-agents/grok` | home-path |
| `optional-skills/autonomous-ai-agents/opencode` | home-path |
| `optional-skills/autonomous-ai-agents/openhands` | home-path |
| `optional-skills/blockchain/evm` | home-path |
| `optional-skills/blockchain/hyperliquid` | home-path |
| `optional-skills/blockchain/solana` | home-path |
| `optional-skills/creative/ascii-art` | home-path |
| `optional-skills/creative/hyperframes` | home-path |
| `optional-skills/creative/ip-as-logo` | hermes-cli:tools |
| `optional-skills/creative/kanban-video-orchestrator` | hermes-cli:dashboard, hermes-cli:kanban, hermes-cli:plugins, hermes-cli:profile, hermes-cli:status, hermes-cli:tools ... |
| `optional-skills/creative/meme-generation` | home-path |
| `optional-skills/creative/pixel-art` | home-path |
| `optional-skills/creative/pretext` | home-path |
| `optional-skills/creative/unreal-mcp` | hermes-cli:mcp, home-path |
| `optional-skills/data-science/jupyter-notebook` | home-path |
| `optional-skills/devops/actual-setup` | hermes-cli:config, hermes-cli:status, home-path |
| `optional-skills/devops/hermes-s6-container-supervision` | hermes-cli:dashboard, hermes-cli:gateway, hermes-cli:profile |
| `optional-skills/devops/pinggy-tunnel` | home-path |
| `optional-skills/devops/watchers` | hermes-cli:cron, home-path |
| `optional-skills/finance/stocks` | home-path |
| `optional-skills/gaming/pokemon-player` | home-path |
| `optional-skills/mcp/fastmcp` | home-path |
| `optional-skills/mcp/mcp-oauth-remote-gateway` | hermes-cli:dashboard, home-path |
| `optional-skills/mlops/training/axolotl` | home-path |
| `optional-skills/payments/stripe-link-cli` | hermes-cli:mcp, hermes-cli:plugins, home-path |
| `optional-skills/productivity/box` | home-path |
| `optional-skills/productivity/canvas` | home-path |
| `optional-skills/productivity/memento-flashcards` | home-path |
| `optional-skills/productivity/shop` | home-path |
| `optional-skills/productivity/siyuan` | home-path |
| `optional-skills/productivity/telephony` | home-path |
| `optional-skills/research/bioinformatics` | home-path |
| `optional-skills/research/darwinian-evolver` | home-path |
| `optional-skills/research/parallel-cli` | home-path |
| `optional-skills/research/qmd` | home-path |
| `optional-skills/security/godmode` | home-path |
| `optional-skills/security/oss-forensics` | home-path |
| `optional-skills/security/unbroker` | home-path |
| `optional-skills/security/web-pentest` | home-path |
| `optional-skills/smart-home/openhue` | home-path |
| `optional-skills/social-media/reddit-reading` | home-path |
| `optional-skills/software-development/ast-grep` | home-path |
| `optional-skills/software-development/code-wiki` | home-path |
| `optional-skills/software-development/hermes-agent-skill-authoring` | home-path |
| `optional-skills/software-development/inspecting-hermes-desktop-dom` | home-path |
| `optional-skills/software-development/node-inspect-debugger` | home-path |
| `optional-skills/software-development/pr-lens` | home-path |
| `optional-skills/software-development/python-debugpy` | hermes-cli:gateway, home-path |
| `optional-skills/web-development/har-derived-api-client` | home-path |
| `optional-skills/yuanbao` | uses-tool:yb_query_group_info, uses-tool:yb_query_group_members, uses-tool:yb_send_dm |
| `skills/apple/findmy` | home-path |
| `skills/autonomous-ai-agents/claude-code` | home-path |
| `skills/autonomous-ai-agents/codex` | hermes-cli:auth, home-path |
| `skills/autonomous-ai-agents/computer-use` | hermes-cli:computer-use, hermes-cli:tools, hermes-cli:update, home-path |
| `skills/autonomous-ai-agents/hermes-agent` | hermes-cli:acp, hermes-cli:auth, hermes-cli:claw, hermes-cli:config, hermes-cli:cron, hermes-cli:curator ... |
| `skills/devops/sdlc-review` | needs-toolset:kanban, uses-tool:kanban_block, uses-tool:kanban_comment, uses-tool:kanban_complete, uses-tool:kanban_request_changes, uses-tool:kanban_show |
| `skills/productivity/google-workspace` | hermes-cli:setup, home-path |
| `skills/productivity/maps` | home-path |
| `skills/productivity/product-price-monitor` | home-path |
| `skills/productivity/teams-meeting-pipeline` | hermes-cli:cron, hermes-cli:teams-pipeline, session-platforms |
| `skills/research/competitor-news-monitor` | home-path |
| `skills/research/grounded-citations` | home-path |
| `skills/software-development/github` | home-path |
| `skills/web/blocked-page-recovery` | home-path |

## Phase 5 re-review list

When terminal, file and browser tools ship, read these again for "on by default": `ascii-video`, `manim-video`, `microsoft-office`, `pdf`, `obsidian`, `dogfood`, `spike`, `systematic-debugging`, `test-driven-development`, `requesting-code-review`, `simplify-code`, `codebase-inspection`.
