import { cn } from "@/app/utils/cn";

/**
 * The "chart" cell of the private section: your computer, with the server
 * and database inside, and your phone, joined by a dashed Tailscale line.
 * Pure SVG; the dashes travel unless the visitor prefers reduced motion.
 */
export default function SyncChart({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 220" className={cn("block h-auto w-full", className)} aria-hidden fontFamily="var(--v4-mono)">
      {/* Computer */}
      <rect x="22" y="44" width="176" height="112" rx="4" fill="var(--v-raised)" stroke="var(--v-line-strong)" />
      <rect x="22" y="44" width="176" height="20" fill="var(--v-surface)" stroke="var(--v-line-strong)" />
      <circle cx="33" cy="54" r="3" fill="var(--v-faint)" />
      <circle cx="43" cy="54" r="3" fill="var(--v-faint)" />
      <text x="110" y="58" textAnchor="middle" fontSize="9" fill="var(--v-soft)">
        this computer
      </text>
      <rect x="38" y="80" width="64" height="30" rx="3" fill="color-mix(in srgb, #c0c1ff 16%, var(--v-surface))" stroke="var(--v-line-strong)" />
      <rect x="38" y="80" width="3" height="30" fill="#c0c1ff" />
      <text x="70" y="99" textAnchor="middle" fontSize="10" fill="var(--v-ink)">
        server
      </text>
      <rect x="118" y="80" width="64" height="30" rx="3" fill="color-mix(in srgb, #12a594 16%, var(--v-surface))" stroke="var(--v-line-strong)" />
      <rect x="118" y="80" width="3" height="30" fill="#12a594" />
      <text x="150" y="99" textAnchor="middle" fontSize="10" fill="var(--v-ink)">
        postgres
      </text>
      <text x="110" y="138" textAnchor="middle" fontSize="9" fill="var(--v-faint)">
        app data folder · encrypted backups
      </text>
      <rect x="86" y="156" width="48" height="6" fill="var(--v-line-strong)" />
      <rect x="60" y="162" width="100" height="4" rx="1" fill="var(--v-line-strong)" />

      {/* Tailscale line */}
      <path d="M198 100 H302" stroke="var(--v-line-strong)" strokeWidth="2" />
      <path d="M198 100 H302" stroke="var(--v-primary)" strokeWidth="2" className="v4-dash" />
      <text x="250" y="90" textAnchor="middle" fontSize="9" fill="var(--v-primary)">
        tailscale
      </text>
      <text x="250" y="120" textAnchor="middle" fontSize="8" fill="var(--v-faint)">
        no cloud between
      </text>

      {/* Phone */}
      <rect x="302" y="36" width="76" height="148" rx="8" fill="var(--v-raised)" stroke="var(--v-line-strong)" />
      <rect x="310" y="48" width="60" height="124" rx="3" fill="var(--v-surface)" />
      <rect x="328" y="44" width="24" height="3" rx="1.5" fill="var(--v-faint)" />
      {/* QR code */}
      <g fill="var(--v-ink)">
        {[
          [322, 76, 12, 12],
          [346, 76, 12, 12],
          [322, 100, 12, 12],
          [340, 94, 4, 4],
          [348, 100, 4, 4],
          [344, 108, 4, 4],
          [352, 112, 6, 4],
          [340, 116, 4, 4],
        ].map(([x, y, w, h]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} />
        ))}
        <rect x="325" y="79" width="6" height="6" fill="var(--v-surface)" />
        <rect x="349" y="79" width="6" height="6" fill="var(--v-surface)" />
        <rect x="325" y="103" width="6" height="6" fill="var(--v-surface)" />
      </g>
      <text x="340" y="140" textAnchor="middle" fontSize="9" fill="var(--v-soft)">
        pair by QR
      </text>
      <rect x="320" y="150" width="40" height="12" rx="2" fill="color-mix(in srgb, #30a66d 18%, var(--v-surface))" />
      <rect x="320" y="150" width="2" height="12" fill="#30a66d" />
      <text x="342" y="159" textAnchor="middle" fontSize="8" fill="var(--v-ink)">
        paired
      </text>
    </svg>
  );
}
