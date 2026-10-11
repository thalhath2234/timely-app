import { Lock } from "lucide-react";
import { AndroidMark } from "@/app/_components/site/marks";
import { C } from "./data";

/** A fixed pseudo-random QR pattern (decorative), so server and client agree. */
const QR = Array.from({ length: 121 }, (_, index) => {
  const x = index % 11;
  const y = Math.floor(index / 11);
  const finder = (x < 3 && y < 3) || (x > 7 && y < 3) || (x < 3 && y > 7);
  if (finder) return !(x % 10 === 1 && (y % 10 === 1 || y === 9)) || (x === 1 && y === 1);
  return ((x * 7 + y * 13 + x * y) % 5) < 2;
});

const LAYERS = [
  { name: "Timely desktop app", note: "Windows or Linux", color: C.violet.bg },
  { name: "Its own server", note: "started by the app", color: C.blue.bg },
  { name: "Its own PostgreSQL database", note: "in your app data folder", color: C.green.bg },
];

/**
 * Where your data lives: the desktop app carries its server and database;
 * the phone pairs by QR code and reaches it over your own Tailscale network.
 */
export default function PrivateDiagram() {
  return (
    <figure aria-labelledby="d4-private-caption" className="m-0">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1.15fr)_minmax(120px,0.7fr)_minmax(0,0.75fr)]">
        {/* Computer */}
        <div className="border border-[var(--line-2)] p-4 sm:p-5">
          <p className="d4-label text-[var(--faint)]">Your computer</p>
          <ol className="mt-4 space-y-1.5">
            {LAYERS.map((layer, index) => (
              <li key={layer.name} className="flex items-stretch gap-3">
                <span className="w-1.5 shrink-0" style={{ background: layer.color }} />
                <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3 border-b border-[var(--line)] py-2.5">
                  <span className="text-[15px] font-bold tracking-[-0.02em] sm:text-[17px]">{layer.name}</span>
                  <span className="d4-mono hidden shrink-0 text-[11px] text-[var(--faint)] sm:inline">{index === 2 ? "PostgreSQL" : layer.note}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 flex items-center gap-2 text-[13px] text-[var(--soft)]">
            <Lock aria-hidden className="size-4 text-[var(--amber)]" />
            Scheduled backups, encrypted, up to 30 kept
          </p>
        </div>

        {/* Link */}
        <div className="relative flex min-h-[96px] items-center justify-center md:min-h-0">
          <span className="absolute top-0 bottom-0 left-1/2 w-px bg-[var(--line-2)] md:top-1/2 md:right-0 md:bottom-auto md:left-0 md:h-px md:w-auto" />
          <span className="d4-packet absolute size-2.5 bg-[var(--amber)]" />
          <span className="d4-packet d4-packet-back absolute size-2.5 bg-[var(--ink)]" />
          <span className="relative bg-[var(--bg)] px-2 py-1 text-center text-[11.5px] leading-tight font-semibold">
            Your own
            <br />
            Tailscale network
          </span>
        </div>

        {/* Phone */}
        <div className="flex gap-4 border border-[var(--line-2)] p-4 sm:p-5">
          <div className="min-w-0 flex-1">
            <p className="d4-label flex items-center gap-2 text-[var(--faint)]">
              <AndroidMark className="size-3.5" />
              Your phone
            </p>
            <p className="mt-4 text-[17px] leading-tight font-bold tracking-[-0.02em]">Paired by QR code</p>
            <p className="mt-2 text-[13px] leading-snug text-[var(--soft)]">Settings › Server › Pair your phone</p>
          </div>
          <div aria-hidden className="grid size-[78px] shrink-0 grid-cols-11 bg-[var(--ink)] p-1.5">
            {QR.map((on, index) => (
              <span key={index} className={on ? "bg-[#0a0a0a]" : ""} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-t border-[var(--line)] pt-5">
        <span aria-hidden className="relative inline-flex h-10 items-center border border-dashed border-[var(--line-2)] px-3 text-[13px] text-[var(--faint)]">
          Timely cloud
          <span className="absolute top-1/2 -right-1 -left-1 h-[2px] -rotate-[8deg] bg-[var(--orange)]" />
        </span>
        <figcaption id="d4-private-caption" className="text-[15px] leading-snug">
          Nothing goes to a Timely cloud, because there isn&apos;t one. Each account is private, and the code is open source.
        </figcaption>
      </div>
    </figure>
  );
}
