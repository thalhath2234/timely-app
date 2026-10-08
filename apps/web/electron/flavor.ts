// Release vs local desktop builds. Electron-free.
//
// Only tagged release builds (release.yml sets TIMELY_RELEASE=1, which
// electron/build.mjs bakes in as __TIMELY_RELEASE__) are "Timely". Everything
// else (make build-desktop, make dist-desktop, make dev-desktop) is "Timely
// Dev": its own app id, user-data folder, single-instance lock and sidecar
// ports, so it runs next to an installed release without touching its data.
// Contract: docs/desktop/README.md ("Local builds").
import { DEFAULT_PORTS, LOCAL_BUILD_PORTS } from "./supervisor/config.ts";
import type { PortSet } from "./supervisor/ports.ts";

declare const __TIMELY_RELEASE__: boolean | undefined;

export type Flavor = {
  release: boolean;
  /** App name: window titles, tray, and the user-data folder name. */
  name: string;
  /** Windows AppUserModelID; matches appId in electron-builder*.yml. */
  appId: string;
  ports: PortSet;
};

export function flavorFor(release: boolean): Flavor {
  return release
    ? { release, name: "Timely", appId: "app.timely.desktop", ports: { ...DEFAULT_PORTS } }
    : { release, name: "Timely Dev", appId: "app.timely.desktop.dev", ports: { ...LOCAL_BUILD_PORTS } };
}

export const FLAVOR = flavorFor(typeof __TIMELY_RELEASE__ === "boolean" && __TIMELY_RELEASE__);
