import type { ReactNode } from "react";

/** One keycap. `pressed` sinks it and lights it amber. */
export function Kbd({ children, pressed = false, size = "md" }: { children: ReactNode; pressed?: boolean; size?: "sm" | "md" | "lg" }) {
  return (
    <kbd className="d3-key" data-pressed={pressed || undefined} data-size={size}>
      {children}
    </kbd>
  );
}

/** A chord or sequence of keycaps, read out as one label. */
export function Keys({ keys, label, size = "md", pressed = -1 }: { keys: string[]; label?: string; size?: "sm" | "md" | "lg"; pressed?: number }) {
  return (
    <span className="d3-keys" aria-label={label ?? keys.join(" ")} role="img">
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`} size={size} pressed={pressed === index || pressed === 99}>
          {key}
        </Kbd>
      ))}
    </span>
  );
}
