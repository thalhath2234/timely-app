// Stand-in for an uploaded chat attachment (GET /chats/images/:id): a photo-like
// whiteboard of sticky notes, served as SVG so it needs no binary asset.
const NOTES: [number, number, string, string][] = [
  [40, 50, "#FFE58F", "Onboarding\nflow v3"],
  [210, 40, "#B5E3FF", "Usability\nround 2"],
  [380, 60, "#C6F6D5", "Ship DS\ntokens"],
  [60, 210, "#FFD6E7", "Portfolio\ncase study"],
  [240, 200, "#FFE58F", "Budget\nreview"],
  [410, 220, "#E9D8FD", "Plan\nnext week"],
];

export function sampleImageBlob(): Blob {
  const notes = NOTES.map(([x, y, fill, text], i) => {
    const lines = text.split("\n").map((t, j) => `<text x="${x + 14}" y="${y + 38 + j * 22}" font-family="Inter, sans-serif" font-size="17" fill="#3b3b4f">${t}</text>`).join("");
    return `<g transform="rotate(${(i % 3) - 1.5} ${x + 70} ${y + 60})"><rect x="${x + 3}" y="${y + 5}" width="140" height="120" fill="#000" opacity=".08"/><rect x="${x}" y="${y}" width="140" height="120" fill="${fill}"/>${lines}</g>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="380" viewBox="0 0 600 380"><rect width="600" height="380" fill="#f4f3ef"/><rect x="12" y="12" width="576" height="356" fill="none" stroke="#d9d7cf" stroke-width="3"/>${notes}</svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}
