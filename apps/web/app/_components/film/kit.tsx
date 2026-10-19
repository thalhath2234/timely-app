import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { blink, fade } from "./anim";
import { C, FONT, HEIGHT, LH, LW, WIDTH, ZOOM } from "./theme";

/**
 * Mock product chrome drawn in code after Timely's own screens: the icon
 * rail, page headers, dashboard cards, the phone with its tab bar. Inline
 * styles only, so the same code plays in the page and renders in Studio.
 */

export function Stage({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        width: WIDTH,
        height: HEIGHT,
        background: C.bg,
        color: C.ink,
        fontFamily: FONT.sans,
        overflow: "hidden",
        opacity: fade(frame, 0, 8),
        ...style,
      }}
    >
      <div style={{ position: "relative", width: LW, height: LH, zoom: ZOOM }}>{children}</div>
    </div>
  );
}

/* ---- Icons: small line icons after the app's lucide set. ---- */

function Icon({ d, size = 18, color = "currentColor", fill = "none" }: { d: string; size?: number; color?: string; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  plus: "M12 5v14M5 12h14",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-3.5-3.5",
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z",
  chat: "M21 12a8 8 0 0 1-8 8H6l-3 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z",
  sun: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  inbox: "M3 13l3-8h12l3 8v6H3zM3 13h5l1.5 3h5L16 13h5",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  tasks: "M4 6h2M4 12h2M4 18h2M10 6h10M10 12h10M10 18h10",
  projects: "M3 7h6l2 2h10v10H3z",
  files: "M7 3h7l5 5v13H7zM14 3v5h5",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3.5 12.5l1.4-.8a7 7 0 0 1 0-1.4l-1.4-.8 1.5-2.6 1.5.5a7 7 0 0 1 1.2-.7l.2-1.6h3l.2 1.6a7 7 0 0 1 1.2.7l1.5-.5 1.5 2.6-1.4.8a7 7 0 0 1 0 1.4l1.4.8-1.5 2.6-1.5-.5a7 7 0 0 1-1.2.7l-.2 1.6h-3l-.2-1.6a7 7 0 0 1-1.2-.7l-1.5.5z",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  hash: "M5 9h14M5 15h14M9 4l-2 16M17 4l-2 16",
  timer: "M12 8v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  sparkle: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z",
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  home: "M3 11l9-7 9 7v9H3zM10 20v-6h4v6",
  check: "M5 12l4 4L19 6",
  key: "M15 3a6 6 0 1 1-4.5 10L8 15.5 6 15v2l-2 2H2v-2l6.5-6.5A6 6 0 0 1 15 3z",
  bot: "M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4zM9 11h.01M15 11h.01M9 15h6M12 1v3",
  arrow: "M5 12h14M13 6l6 6-6 6",
  chevron: "M9 6l6 6-6 6",
  save: "M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-6h8v6",
} as const;

export function I({ name, size, color, fill }: { name: keyof typeof ICONS; size?: number; color?: string; fill?: string }) {
  return <Icon d={ICONS[name]} size={size} color={color} fill={fill} />;
}

const RAIL: (keyof typeof ICONS)[] = ["search", "dashboard", "chat", "sun", "inbox", "calendar", "tasks", "projects", "files", "bell", "settings"];
const RAIL_FOR: Record<string, keyof typeof ICONS> = { Dashboard: "dashboard", Chat: "chat", Today: "sun", Inbox: "inbox", Calendar: "calendar", Tasks: "tasks", Projects: "projects", Files: "files", Settings: "settings" };

/** Timely's logo mark: three bars, the top one longest. */
export function Mark({ size = 22, color = C.ink }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: "block" }}>
      <rect x="3" y="4" width="18" height="4" rx="1.5" />
      <rect x="3" y="10" width="13" height="4" rx="1.5" />
      <rect x="3" y="16" width="8" height="4" rx="1.5" />
    </svg>
  );
}

/** The desktop app: icon rail on the left, a page on the right. */
export function Window({ page, children, style }: { page: string; children: ReactNode; style?: CSSProperties }) {
  const active = RAIL_FOR[page];
  return (
    <div
      style={{
        position: "absolute",
        left: 50,
        right: 50,
        top: 46,
        bottom: 52,
        borderRadius: 16,
        border: `1px solid ${C.line2}`,
        background: "#0e0f15",
        boxShadow: "0 40px 120px -40px rgba(0,0,0,0.85)",
        overflow: "hidden",
        display: "flex",
      }}
    >
      <div style={{ width: 54, flexShrink: 0, borderRight: `1px solid ${C.line}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 0", background: "#0b0c11" }}>
        <Mark size={22} />
        <div style={{ width: 32, height: 32, borderRadius: 9, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 10, marginBottom: 6 }}>
          <I name="plus" size={18} color={C.accentInk} />
        </div>
        {RAIL.map((name) => (
          <div key={name} style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: name === active ? "rgba(184,183,255,0.14)" : "transparent", color: name === active ? C.accent : C.faint }}>
            <I name={name} size={17} />
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0, position: "relative", ...style }}>{children}</div>
    </div>
  );
}

/** The app's page header: big title, one-line subtitle, actions on the right. */
export function PageHeader({ title, subtitle, actions, style }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "22px 24px 14px", ...style }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.15, display: "flex", alignItems: "center", gap: 10 }}>{title}</h2>
        {subtitle ? <p style={{ margin: "4px 0 0", fontSize: 13, color: C.faint }}>{subtitle}</p> : null}
      </div>
      {actions ? <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>{actions}</div> : null}
    </div>
  );
}

/** Buttons as the app draws them: 32 px, radius 10. */
export function Btn({ children, primary = false, icon, style }: { children: ReactNode; primary?: boolean; icon?: keyof typeof ICONS; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 32,
        padding: "0 12px",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        background: primary ? C.accent : "rgba(255,255,255,0.05)",
        color: primary ? C.accentInk : C.ink,
        border: primary ? "1px solid transparent" : `1px solid ${C.line2}`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {icon ? <I name={icon} size={15} /> : null}
      {children}
    </span>
  );
}

/** A segmented control: muted track, the active segment raised. */
export function Segmented({ options, active, style }: { options: string[]; active: string; style?: CSSProperties }) {
  return (
    <span style={{ display: "inline-flex", padding: 3, borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.line}`, fontSize: 13, fontWeight: 500, ...style }}>
      {options.map((option) => (
        <span key={option} style={{ padding: "5px 11px", borderRadius: 8, background: option === active ? C.raised : "transparent", color: option === active ? C.ink : C.faint }}>
          {option}
        </span>
      ))}
    </span>
  );
}

/** A dashboard card with the app's header row: grip, icon, title. */
export function Card({ icon, title, children, style, headerRight }: { icon?: keyof typeof ICONS; title: ReactNode; children?: ReactNode; style?: CSSProperties; headerRight?: ReactNode }) {
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel, padding: 14, display: "flex", flexDirection: "column", boxSizing: "border-box", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: C.ink }}>
        <I name="grip" size={14} color={C.faint} />
        {icon ? <I name={icon} size={15} color={C.soft} /> : null}
        <span>{title}</span>
        {headerRight ? <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>{headerRight}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** A big dashboard number with its coloured bar. */
export function Stat({ value, color = C.accent, note }: { value: ReactNode; color?: string; note?: ReactNode }) {
  return (
    <div style={{ marginTop: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
        <span style={{ width: 3, height: 30, borderRadius: 2, background: color }} />
        {value}
      </div>
      {note ? <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{note}</div> : null}
    </div>
  );
}

const TABS: { name: string; icon: keyof typeof ICONS }[] = [
  { name: "Home", icon: "home" },
  { name: "Calendar", icon: "calendar" },
  { name: "Tasks", icon: "tasks" },
  { name: "Search", icon: "search" },
  { name: "Files", icon: "files" },
];

/** The Android app, or with `home` the Android Home screen. */
export function Phone({ children, style, x = 0, y = 0, tab, home = false }: { children: ReactNode; style?: CSSProperties; x?: number; y?: number; tab?: string; home?: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 340,
        height: 700,
        translate: `${x - 170}px ${y - 350}px`,
        borderRadius: 40,
        border: "3px solid #2b2b35",
        background: home ? "#0c0c11" : "#0e0f15",
        boxShadow: "0 40px 120px -40px rgba(0,0,0,0.9)",
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ position: "absolute", top: 12, left: "50%", translate: "-50% 0", width: 90, height: 24, borderRadius: 99, background: "#000", zIndex: 2 }} />
      {children}
      {!home ? (
        <>
          <div style={{ position: "absolute", right: 16, bottom: 86, width: 50, height: 50, borderRadius: 14, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 30px -10px rgba(184,183,255,0.6)" }}>
            <I name="plus" size={24} color={C.accentInk} />
          </div>
          <div style={{ position: "absolute", left: 10, right: 10, bottom: 10, height: 62, borderRadius: 18, background: "#14151c", border: `1px solid ${C.line}`, display: "flex", justifyContent: "space-around", alignItems: "center" }}>
            {TABS.map((item) => (
              <div key={item.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: 10, color: item.name === tab ? C.accent : C.faint, padding: "6px 10px", borderRadius: 10, background: item.name === tab ? "rgba(184,183,255,0.12)" : "transparent" }}>
                <I name={item.icon} size={18} />
                {item.name}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function Caret({ on = true, color = C.accent, height = 20 }: { on?: boolean; color?: string; height?: number }) {
  const frame = useCurrentFrame();
  return <span style={{ display: "inline-block", width: 2, height, marginLeft: 2, verticalAlign: "-4px", background: color, opacity: on && blink(frame) ? 1 : 0 }} />;
}

export function Chip({ children, color = C.soft, style }: { children: ReactNode; color?: string; style?: CSSProperties }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, border: `1px solid ${C.line2}`, background: "rgba(255,255,255,0.04)", color, fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
}

/** A priority/label pill as the app draws them. */
export function Pill({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: `color-mix(in oklab, ${color} 18%, transparent)`, color, fontSize: 11, fontWeight: 600, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/** A calendar block or task card in a project colour. */
export function Block({ color, children, style }: { color: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, borderRadius: 8, background: `color-mix(in oklab, ${color} 22%, ${C.panel})`, padding: "7px 10px", fontSize: 14, fontWeight: 500, color: C.ink, lineHeight: 1.25, boxSizing: "border-box", ...style }}>
      {children}
    </div>
  );
}

/** The pointer: a small arrow that moves to (x, y). */
export function Pointer({ x, y, pressed = false, opacity = 1 }: { x: number; y: number; pressed?: boolean; opacity?: number }) {
  return (
    <svg width="26" height="30" viewBox="0 0 28 32" style={{ position: "absolute", left: 0, top: 0, translate: `${x}px ${y}px`, scale: pressed ? "0.86" : "1", opacity, filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.6))", zIndex: 5 }}>
      <path d="M3 2 L3 25 L9 19.5 L13.5 29 L18 27 L13.5 18 L22 18 Z" fill="#ffffff" stroke="#111" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** A bottom caption with a chapter number, used by every scene. */
export function Caption({ n, title, note, color = C.accent }: { n: string; title: string; note: string; color?: string }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 50, right: 50, bottom: 16, display: "flex", alignItems: "center", gap: 12, fontSize: 15, color: C.soft, opacity: fade(frame, 6, 12), whiteSpace: "nowrap", overflow: "hidden" }}>
      <span style={{ fontFamily: FONT.mono, color, fontSize: 13 }}>{n}</span>
      <span style={{ color: C.ink, fontWeight: 600 }}>{title}</span>
      <span style={{ color: C.faint }}>·</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{note}</span>
    </div>
  );
}

/** A green check mark. */
export function Check({ size = 18, color = C.green }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="10" cy="10" r="9" fill={color} />
      <path d="M6 10.5 L8.8 13.2 L14 7.8" stroke="#07140d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
