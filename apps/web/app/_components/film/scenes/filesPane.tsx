import { C } from "../theme";
import { I, Segmented } from "../kit";

const FILES = [
  { emoji: "🚀", name: "Website launch brief" },
  { emoji: "💰", name: "Launch budget" },
  { emoji: "📚", name: "Reading list" },
  { emoji: "🗓️", name: "Weekly review: 5 October" },
  { emoji: "📦", name: "Moving checklist" },
];

/** The Files page's left pane, as in the app: search, All/Docs/Sheets, the file list. */
export function FilesPane({ active }: { active: string }) {
  return (
    <div style={{ width: 210, flexShrink: 0, borderRight: `1px solid ${C.line}`, padding: "16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, padding: "0 4px" }}>
        Files
        <span style={{ marginLeft: "auto", display: "flex", gap: 4, color: C.faint }}>
          <I name="plus" size={15} />
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, fontSize: 11, color: C.faint, padding: "0 4px" }}>
        <span>Today</span>
        <span>Template</span>
        <span>Import</span>
      </div>
      <div style={{ height: 30, borderRadius: 8, border: `1px solid ${C.line}`, background: "#0b0c11", display: "flex", alignItems: "center", gap: 6, padding: "0 8px", fontSize: 12, color: C.faint }}>
        <I name="search" size={13} /> Search files
      </div>
      <Segmented options={["All", "Docs", "Sheets"]} active="All" style={{ fontSize: 11 }} />
      <div style={{ display: "grid", gap: 2, marginTop: 4 }}>
        {FILES.map((file) => (
          <div key={file.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, fontSize: 13, background: file.name === active ? "rgba(255,255,255,0.07)" : "transparent", color: file.name === active ? C.ink : C.soft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ fontSize: 13 }}>{file.emoji}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A doc or sheet toolbar strip of small grey glyphs. */
export function ToolbarStrip({ count = 18 }: { count?: number }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}`, alignItems: "center" }}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={{ width: i % 5 === 4 ? 1 : 14, height: i % 5 === 4 ? 14 : 12, borderRadius: 3, background: i % 5 === 4 ? C.line2 : "rgba(255,255,255,0.14)" }} />
      ))}
    </div>
  );
}
