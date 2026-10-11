import { PALETTE } from "@/app/_components/variations/content";

/**
 * Where the data lives: a laptop with the server and database inside, a
 * dashed Tailscale line to the phone, and a cloud that is crossed out.
 * Plain SVG; the dash animates in CSS and stops with reduced motion.
 */
export default function SyncDiagram({ className }: { className?: string }) {
  const soft = "var(--v-soft)";
  const line = "var(--v-line-strong)";
  return (
    <svg viewBox="0 0 360 236" className={className} aria-hidden fontFamily="inherit" fontSize="12">
      {/* Cloud, struck through */}
      <g transform="translate(180 30)">
        <path
          d="M-34 10c-10 0-16-7-16-14 0-8 6-14 15-14 2-10 10-16 21-16 11 0 19 7 21 16h2c9 0 15 6 15 14s-7 14-16 14Z"
          fill="var(--v-surface)"
          stroke={line}
          strokeWidth="1.5"
        />
        <line x1="-42" y1="18" x2="42" y2="-30" stroke={PALETTE.red} strokeWidth="2" strokeLinecap="round" />
        <text x="0" y="36" textAnchor="middle" fill={soft}>
          Nothing goes to someone else&rsquo;s cloud
        </text>
      </g>

      {/* Laptop: screen with server and database inside, then the base */}
      <g transform="translate(22 96)">
        <rect x="0" y="0" width="150" height="96" rx="10" fill="var(--v-surface)" stroke={soft} strokeWidth="1.5" />
        <rect x="-10" y="100" width="170" height="8" rx="4" fill="var(--v-raised)" stroke={soft} strokeWidth="1.5" />
        <rect x="14" y="16" width="122" height="28" rx="7" fill="var(--v-raised)" stroke={line} />
        <circle cx="30" cy="30" r="4" fill={PALETTE.primary} />
        <text x="42" y="34" fill="var(--v-ink)" fontWeight="600">
          Timely server
        </text>
        <rect x="14" y="52" width="122" height="28" rx="7" fill="var(--v-raised)" stroke={line} />
        <ellipse cx="30" cy="66" rx="5" ry="2.5" fill="none" stroke={PALETTE.teal} strokeWidth="1.5" />
        <path d="M25 66v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4" fill="none" stroke={PALETTE.teal} strokeWidth="1.5" />
        <text x="42" y="70" fill="var(--v-ink)" fontWeight="600">
          Postgres
        </text>
        <text x="75" y="130" textAnchor="middle" fill={soft}>
          Your computer
        </text>
      </g>

      {/* Tailscale link */}
      <g transform="translate(194 148)">
        <line x1="0" y1="0" x2="86" y2="0" stroke={PALETTE.primary} strokeWidth="2" className="v2-dash" />
        <path d="M6 -5l-6 5 6 5" fill="none" stroke={PALETTE.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M80 -5l6 5-6 5" fill="none" stroke={PALETTE.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <text x="43" y="-10" textAnchor="middle" fill={PALETTE.primary} fontWeight="600">
          Tailscale
        </text>
      </g>

      {/* Phone */}
      <g transform="translate(290 100)">
        <rect x="0" y="0" width="52" height="96" rx="10" fill="var(--v-surface)" stroke={soft} strokeWidth="1.5" />
        <rect x="6" y="10" width="40" height="72" rx="5" fill="var(--v-raised)" />
        <rect x="11" y="18" width="30" height="6" rx="3" fill={PALETTE.green} opacity="0.9" />
        <rect x="11" y="30" width="22" height="6" rx="3" fill={line} />
        <rect x="11" y="42" width="30" height="6" rx="3" fill={PALETTE.violet} opacity="0.9" />
        <rect x="11" y="54" width="18" height="6" rx="3" fill={line} />
        <rect x="20" y="88" width="12" height="2" rx="1" fill={soft} />
        <text x="26" y="126" textAnchor="middle" fill={soft}>
          Your phone
        </text>
      </g>
    </svg>
  );
}
