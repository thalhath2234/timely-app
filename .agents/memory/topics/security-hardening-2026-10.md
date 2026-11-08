---
name: security-hardening-2026-10
description: Security review + PR #83 (merged 2026-10-05) changed startup/release behavior; open follow-ups for v1
metadata:
  type: project
  modified: 2026-10-05T11:48:36.925Z
---

Security review on 2026-10-05; fixes merged in PR #83 (into dev). The report is at /mnt/project-files/security/2026-10-05-security-review.md. User wants the app at v1 soon.

Behavior changes to remember:
- The API refuses to start if JWT_SECRET is empty, under 32 chars, a `replace-with-*` placeholder, or the secret leaked in PR #32 (it checks the SHA-256 in auth/token.go). setup-env.sh now generates the secrets.
- ALLOW_REGISTRATION defaults to false, so only the first account can sign up (API and desktop config).
- Tagged release builds FAIL without the ANDROID_* keystore secrets (no more debug-key APKs). See [release-flow](release-flow.md).
- release.yml: read-only token by default, APK upload in its own `android-release` job, and actions pinned to SHAs.
- The API Docker image runs as uid 10001; older volumes need a chown.

**Why:** The v0.1.3 APK was signed with the public debug key, and a real JWT secret is in the git history.
**How to apply:** For release or setup failures, check the items above first. The open v1 security follow-ups are:
- bundle TipTap locally in the mobile editor (it still loads from esm.sh)
- Electron fuses and the macOS entitlements
- a CSP for the web app
- npm build-tool advisories
- govulncheck, which is blocked in cloud sessions
