# Making a release build

How to cut a Timely release: the desktop installers (Windows, Linux, macOS) and
the Android APK, published together as one GitHub Release. Builds run in GitHub
Actions (`.github/workflows/release.yml`); you only bump the version, merge, and
tag. For how the desktop bundle is put together, see
[`docs/desktop/README.md`](docs/desktop/README.md).

## What a release contains

Pushing a tag `vX.Y.Z` produces one GitHub Release named `Timely vX.Y.Z` with:

| Platform | File | Built on |
| --- | --- | --- |
| Windows | `Timely-X.Y.Z-win-x64.exe` (NSIS installer, per-user) + `latest.yml` | `windows-latest` |
| Linux | `Timely-X.Y.Z-linux-x86_64.AppImage` + `latest-linux.yml` | `ubuntu-latest` |
| macOS | `.dmg` and `.zip` for x64 and arm64 + `latest-mac.yml` | `macos-14` |
| Android | `Timely-X.Y.Z-android-arm64.apk` | `ubuntu-latest` |

The `latest*.yml` manifests and `.blockmap` files are what the desktop app's
auto-updater reads, so every release has to go through the workflow. An
installer uploaded by hand without them is invisible to existing installs.

## Where the version lives

The single release version is `version` in **`apps/web/package.json`**. It is
used for the installer file names, the API binary (`-X main.version=...`, shown
by `GET /health`), the APK file name, and the tag check. The `prepare` job fails
the whole release if the tag is not exactly `v` + that version.

Other `version` fields (root `package.json`, `apps/mobile/package.json`,
`apps/mobile/app.json`) are not used by the release and do not need bumping.

## Steps

Branches: day-to-day work lands on `dev`; `main` holds released code.

1. **Bump the version on `dev`.** On a branch off `dev`, change
   `apps/web/package.json` `version` (for example `0.1.3` → `0.1.4`), open a PR
   into `dev`, wait for CI (`ci.yml`: Go vet/test, ESLint, typecheck, Node
   tests) to go green, and merge it.
2. **Merge `dev` into `main`.** Open a PR from `dev` to `main` and merge it.
3. **Tag `main`.** Either create the release on GitHub (*Releases → Draft a new
   release → Choose a tag → `vX.Y.Z` on `main` → Publish*), or from a terminal:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

   The tag push starts the `release` workflow. If you publish the release
   yourself first, the workflow reuses it instead of creating a new one.
4. **Watch the run** under *Actions → release*. Jobs: `prepare` (version check
   and release creation), `desktop` (Linux, macOS, Windows in parallel) and
   `android`. Each job uploads its files to the release as it finishes, and also
   keeps them as workflow artifacts. A failed job can be re-run on its own; it
   uploads to the existing release.
5. **Check the release page.** All files from the table above should be there.
   Edit the auto-generated notes if needed.
6. **Update the AUR package** (below).

### Dry run without publishing

*Actions → release → Run workflow* (`workflow_dispatch`) builds everything with
`--publish never`. Nothing is published; download the installers and APK from
the run's artifacts to test them.

## After the release: AUR package

`packaging/aur/timely-bin/` repackages the Linux AppImage from the release for
Arch Linux. Once the AppImage is on the release:

1. In `PKGBUILD`, set `_tag=vX.Y.Z`, `_ver=X.Y.Z`, `pkgver=X.Y.Z`, and reset
   `pkgrel=1`.
2. Refresh the AppImage checksum (the first entry in `sha256sums`). On Arch run
   `updpkgsums` in that folder; elsewhere:

   ```bash
   curl -L -o Timely.AppImage \
     https://github.com/thalhath2234/timely-app/releases/download/vX.Y.Z/Timely-X.Y.Z-linux-x86_64.AppImage
   sha256sum Timely.AppImage
   ```

   Leave the second checksum (the pinned `LICENSE`) as it is.
3. Regenerate `.SRCINFO` with `makepkg --printsrcinfo > .SRCINFO`, or edit the
   same version, URL, file name and checksum fields by hand.
4. Commit to `dev` and `main` via PRs, the same way as the version bump.
5. Push the two files to the AUR git repository (`ssh://aur@aur.archlinux.org/timely-bin.git`).
   That repository is separate from this one.

## Building locally

You don't need these for a release, but they produce the same artifacts on your
own machine, for the current OS only (no cross-OS installers).

| Command | Output |
| --- | --- |
| `make dist-desktop` | Installer for this OS in `apps/web/release/` (`.exe` on Windows, `.AppImage` on Linux, `.dmg`/`.zip` on macOS) |
| `make build-desktop` | Unpacked app in `apps/web/release/<platform>-unpacked/`, quicker to test |
| `make build-apk` | Android release APK at `apps/mobile/timely-release-arm64.apk` (Linux, needs the Android SDK and JDK 17; never run Gradle directly) |
| `make install-apk` | Same APK, installed on a USB-connected phone |

The desktop build runs `next build`, compiles the Electron main process, then
stages the Go API (`electron/stage-api.mjs`) and PostgreSQL 17
(`electron/stage-postgres.mjs`) as sidecars before electron-builder packages
everything. It needs Node 22+, pnpm, and Go 1.25.7+; Postgres binaries are
downloaded and cached in `apps/web/.cache/postgres/`. Set
`TIMELY_SKIP_NEXT=1` to reuse the last Next build while iterating on packaging.

## Signing

All signing is optional. Without the secrets below the builds are unsigned and
the release still works.

| Secret (repo *Settings → Secrets → Actions*) | Effect |
| --- | --- |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Signs the Windows installer (`.pfx`, base64). Without it SmartScreen shows *More info → Run anyway* |
| `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Signs and notarizes macOS. Unsigned mac builds open with right-click → *Open* and cannot auto-update |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Signs the APK with a release keystore. Without it the APK uses the debug key |

Switching the APK from the debug key to a release keystore (or changing
keystores) means users must uninstall the old app once, since Android refuses
an update signed with a different key.

## Troubleshooting

- **`tag vX.Y.Z does not match apps/web/package.json version`**: the tag was
  pushed before the bump reached `main`. Delete the tag and its release on
  GitHub, merge the bump, and tag again.
- **A desktop or Android job failed**: open the job log, fix the cause on `dev`,
  and either re-run the failed job (same code) or, if code changed, release the
  fix as the next patch version. Re-tagging a published version confuses the
  updater for anyone who already installed it.
- **Release has installers but no `latest*.yml`**: it was not published by the
  workflow. Re-run the `desktop` job for that tag.
