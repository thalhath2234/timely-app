# Screenshot audit assets

[Main audit](../Audit.Md) · [Searchable gallery](index.html) · [Source inventory](component-inventory.md)

## What is here

- `screenshots/`: original PNG captures of Timely's running UI. Numbered names identify the feature and state; numbers have gaps because capture work was grouped by feature.
- `index.html`: portable gallery. Open it directly in a browser; it has no network or package dependencies. Search by task, calendar, settings, editor, sheet, dark, desktop min, component, error or Electron. Click an image to inspect full resolution.
- `manifest.json`: filename, route, time, capture kind, viewport when available, PNG dimensions and integrity hash.
- `component-inventory.md` / `source-inventory.json`: every page and component source file, with representative screenshots. Source symbols include nested components; nonvisual helpers are explicitly identified.
- `evidence/`: visible page text collected alongside screenshots, plus targeted environment/layout/export/error evidence. Text can include content outside an internal scroll viewport; the PNG is the authority for what was visually shown.
- `scripts/`: standard-library Python scripts to validate/rebuild the gallery and coverage inventory.

## Capture method

The source revision was `65ae32a5dd97adb83f5badc17b6bc6e7dcee0c89`. Dependencies were installed using the root pnpm workspace and frozen lockfile. The app ran through root Make targets, with the audit web server on port 4050 and API on 8080. The audit did not modify product component code.

A dedicated audit account and Design Studio workspace were created through registration/onboarding. Sample entities were created through the real API to populate representative states, followed by UI interactions. These are real app renders, not design mockups or image-generation output. The original account data was not used as a screenshot fixture.

Playwright Core drove local Chromium. The normal desktop viewport was 1440×1000, light theme, Asia/Tokyo. A second pass used dark theme, and a third used 900×600, matching the Electron window's minimum content size. Electron was launched under Xvfb with a separate temporary user-data directory. Actual renderer screenshots and version metadata are included. OS window decorations and native menus are not included in renderer captures.

Full-page browser capture does not automatically reveal internal scroll containers. Additional `scroll` images, horizontal task-table captures and `component` crops cover those areas. Main screenshots preserve the page context; crops provide reusable individual visual references.

Next.js developer overlays were hidden with a capture-only stylesheet. A recoverable workspace-settings hydration error is preserved in separate diagnostic evidence. A generated API secret was replaced with `tk_REDACTED_AUDIT_KEY` before screenshot/text capture, then the temporary key was revoked. Its shortened prefix in the key list is not a usable credential.

`108-tasks-load-error-simulated` used browser request interception to return a deliberate HTTP 503. `109-tasks-retry-recovered` was captured after removing interception and retrying the real API. `102-offline-banner` used browser offline emulation and restored connectivity immediately afterward. These are test-induced states, not claims of a naturally occurring service outage.

The capture pass resumed later on September 15, with final artifact verification on September 16. Notification times, scheduling proposals and sample entity counts change across captures. Capture timestamps in the manifest preserve that history. The dedicated sample account and data remain available; its generated API key is revoked. Credentials/session files and full exported account backups are not included here.

## Rebuild the indexes

From the repository root:

```sh
make audit-index
```

This verifies screenshot presence and source-file coverage, then rebuilds `index.html`, `component-inventory.md` and `source-inventory.json`. It does not recapture the application. The source revision and representative mappings describe this audit snapshot.

To run an isolated web audit environment:

```sh
make dev-api
make audit-web
```

The API uses its configured database and startup migrations. Use an appropriate environment and a dedicated account for later audits. `AUDIT_PORT` defaults to 4050 and can be overridden.

For Linux Electron renderer capture, `make audit-desktop` compiles the Electron entry points and launches the installed Electron binary under Xvfb. `AUDIT_ELECTRON_BIN` can point to an already installed binary. This target uses `/tmp/timely-design-audit-electron` and debug port 4061; it is an audit launcher, not a packaging command.

## What this audit does not certify

See section 6 of `Audit.Md`. In particular, source coverage is not exhaustive behavioral regression coverage. No mobile audit, production installer certification, OS notification delivery certification, or WCAG conformance claim is made. Native dialogs and platform-specific menus are inventoried from source where they were not captured.
