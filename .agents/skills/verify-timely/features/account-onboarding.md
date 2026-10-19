# Account and onboarding

A new user creates an account with name, email and password. They then go through two onboarding steps: what Timely is for, which adds starter labels, and naming the first workspace. A short first-run tour follows, and then they land in the app. They can sign out and sign back in. Private routes send signed-out visitors to `/login`.

## Sub-features

- `account-signup`: `/signup` creates the account and moves on to `/onboarding`.
- `account-onboarding-uses`: step 1, "What fills your days?", has use chips and starter labels. `Continue` or `Skip for now` moves on.
- `account-onboarding-workspace`: step 2, "Name your first workspace.", has a name field, suggested names and `Create workspace`.
- `account-tour`: the dialog "A short tour of Timely", with `Skip` or the final button, leads to the app (`/calendar` for a web signup).
- `account-signout`: the sidebar `Sign out` returns to `/login`, and private routes then redirect to `/login`.
- `account-signin`: `/login` with Email, Password and `Sign in` lands in the app.
- `account-signup-closed`: when registration is closed and an account exists, `/signup` shows "New accounts are turned off here.".

## How to get to it (user POV)

- Landing page `/`, then Register or Get Started. Or go to `/signup` directly. The `Log in` link in the header goes to `/login`.
- Any private route (`/inbox`, `/tasks`, `/calendar`, ...) while signed out redirects to `/login`.
- `Sign out` sits at the bottom of the sidebar.

## Driving it with browser.mjs

Preconditions:

- `$V doctor` reports OK (registration open).
- The browser is signed out. Run `$V browser` for a fresh profile.
- `E=verify+$(date +%s)@example.invalid` and `P=verify-pass-1234`.

Steps:

- **Signed-out redirect.** Open a private route. Run `$B open /inbox` and `$B wait --url-includes /login`. The heading of the sign-in page is visible.
- **Sign up.** Run `$B open /signup`, then `$B fill --label Name --value "Verify Bot"`, `$B fill --label Email --value "$E"`, `$B fill --label Password --exact --value "$P"` and `$B click --role button --name "Create account"`. The notice `Account created. Setting up your first day…` appears, then `$B wait --url-includes /onboarding --timeout 60000`.
- **Step 1.** The heading `What fills your days?` and the text `Step 1 of 2 · What it’s for` are visible. Choose a use chip from `$B snapshot`, and starter labels appear under "Starter labels". Choose `Continue`, or run `$B click --role button --name "Skip for now"`.
- **Step 2.** The heading `Name your first workspace.` is visible. Run `$B fill --label "Workspace name" --value Verify`, then `$B click --role button --name "Create workspace"`.
- **Tour.** Run `$B wait --role dialog --name "A short tour of Timely" --timeout 60000`, then `$B click --in-role dialog --in-name "A short tour of Timely" --role button --name Skip --exact`. The URL leaves `/onboarding` (`/calendar`), and the sidebar shows `Inbox`, `Tasks` and `Sign out`.
- **Second view.** Run `$B api GET /me --path $RUN/account-signup.me.json`. The email equals `$E`. Run `$B api GET /workspaces --path $RUN/account-onboarding-workspace.api.json`, which includes `Verify`.
- **Sign out.** Run `$B click --role button --name "Sign out"` and `$B wait --url-includes /login`. Then `$B open /tasks` stays on `/login`.
- **Sign in.** Run `$B fill --label Email --value "$E"`, `$B fill --label Password --exact --value "$P"` and `$B click --role button --name "Sign in" --exact`. Then `$B wait --role link --name Inbox --exact --timeout 60000` (sidebar).
- **Proof.** Run `$B screenshot --path $RUN/account-signin.png` and `$B snapshot --path $RUN/account-signin.aria.yml`.
- **Shortcut.** `$B signup-onboard --email "$E" --password "$P"` runs the sign-up, both onboarding steps and the tour in one call. It is a baseline for other features and does not prove the sub-steps.

## Gotchas

- `--label Password` also matches the `Show password` button. Always pass `--exact`.
- `account-signup-closed` cannot be reached on the verify instance, because `up` starts the API with `ALLOW_REGISTRATION=true`. To prove it, start a separate API without that flag on an empty `VERIFY_TIMELY_SCHEMA` that already holds one account. Report it as unverified otherwise.
- The tour picks its target route before the config refetch. The landing route after the tour is `/calendar` on the web. In the desktop app, the first-run wizard (Tailscale, provider, pairing) runs instead.
- Settings → Account → `Delete account…` is shown only inside the desktop (Electron) app. On the web, remove the run's account with `$B api DELETE /me --body '{"password":"..."}'` as fixture cleanup.
- Login and register are rate-limited (`limiter.Middleware(true)`). Don't loop sign-ins quickly.
