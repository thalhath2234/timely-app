/**
 * The privacy diagram: a computer with its own server and database inside,
 * paired to a phone over a dashed Tailscale line, and nothing in between.
 */
export default function SyncDiagram() {
  const ink = "#ecebf5";
  const line = "rgb(236 235 245 / 22%)";
  const green = "var(--v3-inbox)";
  return (
    <svg viewBox="0 0 320 200" className="block h-auto w-full" aria-hidden>
      {/* Computer */}
      <rect x={14} y={30} width={160} height={104} rx={6} fill="var(--v-bg)" stroke={line} />
      <rect x={14} y={30} width={160} height={3} fill="var(--v3-scheduled)" />
      <rect x={60} y={134} width={68} height={6} fill={line} />
      <rect x={44} y={140} width={100} height={4} rx={1} fill={line} />
      <text x={26} y={52} fill={ink} fontFamily="var(--font-mono)" fontSize={9} letterSpacing={0.8}>
        THIS COMPUTER
      </text>
      <rect x={26} y={62} width={64} height={56} rx={4} fill="var(--v-surface)" stroke={line} />
      <text x={58} y={84} textAnchor="middle" fill={ink} fontSize={10} fontWeight={600} fontFamily="var(--font-sans)">
        Timely
      </text>
      <text x={58} y={98} textAnchor="middle" fill="#a8a7bb" fontSize={9} fontFamily="var(--font-sans)">
        server
      </text>
      <rect x={98} y={62} width={64} height={56} rx={4} fill="var(--v-surface)" stroke={line} />
      <ellipse cx={130} cy={78} rx={14} ry={5} fill="none" stroke={green} strokeWidth={1.5} />
      <path d="M116 78v14a14 5 0 0 0 28 0V78" fill="none" stroke={green} strokeWidth={1.5} />
      <path d="M116 85a14 5 0 0 0 28 0" fill="none" stroke={green} strokeWidth={1.5} />
      <text x={130} y={110} textAnchor="middle" fill="#a8a7bb" fontSize={9} fontFamily="var(--font-sans)">
        Postgres
      </text>

      {/* Tailscale line */}
      <line x1={176} y1={92} x2={250} y2={92} stroke={green} strokeWidth={1.5} strokeDasharray="4 4" />
      <path d="M182 88l-6 4 6 4M244 88l6 4-6 4" fill="none" stroke={green} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <text x={213} y={82} textAnchor="middle" fill={green} fontFamily="var(--font-mono)" fontSize={8} letterSpacing={0.8}>
        TAILSCALE
      </text>

      {/* Phone */}
      <rect x={254} y={44} width={52} height={96} rx={8} fill="var(--v-bg)" stroke={line} />
      <rect x={254} y={44} width={52} height={3} fill="var(--v3-inbox)" />
      <rect x={272} y={50} width={16} height={3} rx={1.5} fill={line} />
      <rect x={262} y={62} width={36} height={8} rx={2} fill="var(--v-surface)" stroke={line} />
      <rect x={262} y={76} width={36} height={14} rx={2} fill="var(--v3-scheduled)" opacity={0.7} />
      <rect x={262} y={96} width={36} height={14} rx={2} fill="var(--v3-clarified)" opacity={0.7} />
      <rect x={262} y={116} width={22} height={8} rx={2} fill="var(--v-surface)" stroke={line} />
      <text x={280} y={160} textAnchor="middle" fill={ink} fontFamily="var(--font-mono)" fontSize={9} letterSpacing={0.8}>
        PHONE
      </text>

      {/* The cloud that is not involved */}
      <g opacity={0.55}>
        <path
          d="M128 178c-10 0-14-8-10-14 2-10 16-10 20-4 4-6 16-5 18 2 8-2 14 4 12 10-1 5-6 6-10 6z"
          fill="none"
          stroke="var(--v3-done)"
          strokeWidth={1.3}
        />
        <line x1={110} y1={158} x2={176} y2={184} stroke="var(--v3-done)" strokeWidth={1.5} strokeLinecap="round" />
        <text x={190} y={176} fill="#a8a7bb" fontFamily="var(--font-mono)" fontSize={8} letterSpacing={0.8}>
          NO CLOUD IN BETWEEN
        </text>
      </g>
    </svg>
  );
}
