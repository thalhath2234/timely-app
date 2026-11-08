---
name: landing-and-help-center
description: Landing page + /help history: #145 day-in-Timely (2026-10-11), then the 2026-10-18 "Chapters" overhaul with a Remotion film (PR #227, merged to dev 2026-10-18)
metadata:
  type: project
  modified: 2026-10-18T11:03:21.091Z
---

**2026-10-18 overhaul (thread "Landing and help overhaul", PR #227 merged into dev 2026-10-18 as 3c5064d at user's "merge it", CI green).** User asked for a full overhaul with the Remotion plugin, no reuse of old assets, "use fable". Picked direction 1 "Chapters" of 3 (others: 2 and 3 unused). Scenes must look like the real app (user: "assets should represent the real application screen", emphasise custom widgets and card creation).
- Landing `apps/web/app/page.tsx` + `app/_components/home/` (filmStage.tsx Player of the film with chapter rail, chapterSection.tsx, scenePlayer.tsx, downloads.tsx, reveal.tsx). Film `app/_components/film/` (theme.ts, anim.ts, kit.tsx app-look kit, chapters.ts pure data, scenes/*.tsx, 1600x1000 @30fps, 11 chapters x 5 s). Remotion is client-only: server components import chapters.ts data, never scenes. `make film-studio` / `make film-render`; stills: `npx remotion still TimelyFilm out.png --frame=N --browser-executable=""`.
- Autoplay in view with a rail (scroll-scrub rejected in critique). Always-dark `.site`, tokens `--s-*` in site/site.css, Bricolage Grotesque display (site/siteFont.ts). Old `app/_components/landing/` deleted; auth pages still use `.lp-*` + Archivo.
- /help home rebuilt (task cards, install cards, thirty-second tours from the film, section index); help articles recolored to the tokens, screenshots in public/help/*.webp kept.
- Review material: /mnt/project-files/landing-overhaul/ (critique.md, sketch-critique.md, system.md, copy.md, mocks/, shots/ incl. film-chapters.png).
- 2026-10-18 help refresh (same branch): every article updated for v0.3.4 features, new /help/start/widgets article, help home "New since v0.3.3" list. Agent keys have NO scopes (one key per agent, revoke). New help shots come from real-app screenshots in /mnt/project-files/<thread>/ (crop, cover Next dev badge at 37,862), Shot takes size={{width,height}}. Stale still: doc.webp, sheet.webp, clarify.webp, tasks*.webp, quick-prompt.webp.
- Remotion licence: free for individuals and companies up to 3 people; told the user.

**Earlier: PR #145 (2026-10-11, merged)** "a day in Timely" landing (replaced above), /help center (content as typed data in `app/_components/help/content/*.tsx`, registry + search index, 28 static articles at /help/<section>/<slug>, install guides Windows/Ubuntu/Arch/Android, no macOS). Public pages must call `usePublicSite()` (site/motion.tsx) so in-app Reduce motion doesn't freeze them. Help sidebar in `app/help/(articles)/layout.tsx` keeps scroll between articles. New features should get a help article.

**How to apply:** rejected landing ideas (don't re-propose): day-in-Timely, ink and paper, command line, Swiss kinetic week, focus, sticky-note desk, Ask, Board, Sheet, Dashboard (see [landing-variations](landing-variations.md)). User wants AI as the main selling point and scenes drawn after real app screens. Related: [design-system](design-system.md).
