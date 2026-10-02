import type { CSSProperties } from "react";

/** Sets the entity colour that an `.l-hue` element derives its pastels from. */
export function hueStyle(hue: string): CSSProperties {
  return { "--hue": hue } as CSSProperties;
}
