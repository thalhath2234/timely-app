import { PALETTE } from "@/app/_components/variations/content";

/**
 * Your computer, with the server and database inside, paired to your phone
 * over your own Tailscale network. The cloud is crossed out on purpose.
 */
export function SyncDiagram() {
  return (
    <svg viewBox="0 0 360 200" className="h-auto w-full" role="img" aria-label="The desktop app's server and database on your computer, connected to your phone over Tailscale. No cloud in between.">
      <defs>
        <marker id="v5-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 Z" fill="var(--v-primary)" />
        </marker>
      </defs>

      {/* Laptop */}
      <g transform="translate(16 36)">
        <rect x="0" y="0" width="150" height="100" rx="8" fill="var(--v-bg)" stroke="var(--v-line-strong)" />
        <rect x="-10" y="100" width="170" height="8" rx="3" fill="var(--v-raised)" stroke="var(--v-line-strong)" />
        <text x="12" y="20" fontSize="9" fontWeight="600" letterSpacing="0.08em" fill="var(--v-soft)">
          YOUR COMPUTER
        </text>
        <g transform="translate(12 30)">
          <rect width="58" height="54" rx="5" fill="var(--v-surface)" stroke="var(--v-line-strong)" />
          <rect x="8" y="10" width="42" height="4" rx="2" fill={PALETTE.primary} />
          <rect x="8" y="19" width="30" height="4" rx="2" fill="var(--v-faint)" />
          <rect x="8" y="28" width="36" height="4" rx="2" fill="var(--v-faint)" />
          <text x="29" y="47" fontSize="8.5" fontWeight="600" textAnchor="middle" fill="var(--v-ink)">
            server
          </text>
        </g>
        <g transform="translate(80 30)">
          <rect width="58" height="54" rx="5" fill="var(--v-surface)" stroke="var(--v-line-strong)" />
          <ellipse cx="29" cy="14" rx="16" ry="5" fill="none" stroke={PALETTE.green} strokeWidth="1.5" />
          <path d="M13 14v16c0 2.8 7.2 5 16 5s16-2.2 16-5V14" fill="none" stroke={PALETTE.green} strokeWidth="1.5" />
          <path d="M13 22c0 2.8 7.2 5 16 5s16-2.2 16-5" fill="none" stroke={PALETTE.green} strokeWidth="1.5" />
          <text x="29" y="47" fontSize="8.5" fontWeight="600" textAnchor="middle" fill="var(--v-ink)">
            Postgres
          </text>
        </g>
      </g>

      {/* Tailscale line */}
      <g>
        <path d="M186 86 H276" stroke="var(--v-line-strong)" strokeWidth="1.5" />
        <path d="M186 86 H276" stroke="var(--v-primary)" strokeWidth="1.5" className="v5-dash" markerStart="url(#v5-arrow)" markerEnd="url(#v5-arrow)" />
        <rect x="200" y="94" width="62" height="16" rx="8" fill="var(--v-surface)" stroke="var(--v-line-strong)" />
        <text x="231" y="105" fontSize="8.5" fontWeight="600" textAnchor="middle" fill="var(--v-ink)">
          Tailscale
        </text>
        {/* padlock */}
        <g transform="translate(224 58)">
          <rect x="0" y="6" width="14" height="10" rx="2" fill={PALETTE.green} />
          <path d="M3 6V4a4 4 0 0 1 8 0v2" fill="none" stroke={PALETTE.green} strokeWidth="1.8" />
        </g>
      </g>

      {/* Phone */}
      <g transform="translate(284 44)">
        <rect x="0" y="0" width="56" height="100" rx="9" fill="var(--v-bg)" stroke="var(--v-line-strong)" />
        <rect x="20" y="6" width="16" height="3" rx="1.5" fill="var(--v-faint)" />
        <rect x="7" y="16" width="42" height="26" rx="3" fill="var(--v-surface)" stroke="var(--v-line)" />
        <rect x="11" y="21" width="20" height="3" rx="1.5" fill={PALETTE.primary} />
        <rect x="11" y="28" width="30" height="3" rx="1.5" fill="var(--v-faint)" />
        <rect x="11" y="35" width="24" height="3" rx="1.5" fill="var(--v-faint)" />
        <g transform="translate(14 52)">
          {[0, 1, 2, 3].map((row) =>
            [0, 1, 2, 3].map((col) => (
              <rect key={`${row}-${col}`} x={col * 7} y={row * 7} width="5" height="5" fill={(row + col) % 3 === 0 || (row === col) ? "var(--v-ink)" : "var(--v-line-strong)"} />
            )),
          )}
        </g>
        <text x="28" y="92" fontSize="7.5" fontWeight="600" textAnchor="middle" fill="var(--v-soft)">
          pairs by QR
        </text>
      </g>

      {/* The cloud that is not there */}
      <g transform="translate(196 6)" opacity="0.7">
        <path d="M14 30h40a10 10 0 0 0 0-20 14 14 0 0 0-27-3 9 9 0 0 0-13 23z" fill="none" stroke="var(--v-faint)" strokeWidth="1.5" />
        <path d="M8 34 L62 2" stroke={PALETTE.red} strokeWidth="2" strokeLinecap="round" />
      </g>
      <text x="230" y="52" fontSize="7.5" textAnchor="middle" fill="var(--v-soft)">
        no cloud in between
      </text>
    </svg>
  );
}
