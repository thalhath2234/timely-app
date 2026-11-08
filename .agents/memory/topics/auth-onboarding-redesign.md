---
name: auth-onboarding-redesign
description: PR #146 (2026-10-11) redesigned login, signup, onboarding and desktop /setup as "a day in Timely" on web and phone
metadata:
  type: project
  modified: 2026-10-11T10:26:22.313Z
---

PR #146 (feature/auth-onboarding-redesign-m6n5o1 -> dev), thread "Redesign the Login, Signup and onboarding screen". Merged into dev 2026-10-11. Follow-up PR #150 (merged into dev 2026-10-11) moved web buttons/fields onto the shared kit ([design-system](design-system.md)); phone AuthKit keeps its own dark colours because the phone kit follows the app theme, but uses kit sizes/corners. Shots: /mnt/project-files/auth-onboarding/kit/.

- Continues the landing page ([landing-and-help-center](landing-and-help-center.md)): always dark `.site .lp`, Archivo condensed headline, the landing's date line, the form shown as the block happening now ("10:05–10:10 Sign in"), and a day panel on the right (hour gutter, now marker at the real time) that fills in with the user's name, starter labels, workspaces and setup steps.
- Web: `app/_components/auth/` (AuthShell, DayPanel, fields, sampleDay, clock). The Archivo font is shared through `site/displayFont.ts`. Sign-up reads `/health` registrationOpen and shows "New accounts are turned off here".
- Phone: `apps/mobile/components/auth/AuthKit.tsx` + `lib/authDay.ts`, always dark. Bundles `assets/fonts/Archivo-CondensedExtraBold.ttf` (OFL). Phone onboarding gained Sign out.
- The "App-wide UI review and shared components" thread is building a shared kit. These auth kits are kept self-contained so they can move onto it.
- Screens + critique: /mnt/project-files/auth-onboarding/ (before/, web/, phone-app/, critique.md). Desktop setup was shot with a mocked desktop bridge, so it is untested in a real desktop build.
- Expo web testing: start the API with CORS_ORIGINS=http://localhost:8082 and Expo with EXPO_PUBLIC_API_URL=http://localhost:8081 in its environment (the root .env alone left it on 10.0.2.2).
