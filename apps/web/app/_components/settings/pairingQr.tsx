"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy } from "lucide-react";
import type { DesktopInstance } from "@/electron-env";
import { pairingPayload, pairingUrls, primaryAddress } from "@/app/utils/desktopInstance";
import { useDesktopBridge } from "@/app/utils/hooks/desktop";

const QR_SIZE = 220;

const secondaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted/60 disabled:opacity-60";

/** The QR code the phone scans, plus the first address for typing by hand.
 * Encodes `JSON.stringify(instance.pairing)` exactly (docs/desktop/README.md). */
export default function PairingQr({ instance }: { instance: DesktopInstance }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bridge = useDesktopBridge();
  const [renderError, setRenderError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);
  const payload = pairingPayload(instance);
  const address = primaryAddress(instance);
  const urls = pairingUrls(instance);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    QRCode.toCanvas(canvas, payload, {
      errorCorrectionLevel: "H",
      width: QR_SIZE,
      margin: 2,
    })
      .then(() => {
        if (!cancelled) setRenderError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : "Could not draw the QR code.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied("done");
    } catch {
      const fallback = bridge ? await bridge.action("copyAddress").catch(() => null) : null;
      setCopied(fallback?.ok ? "done" : "failed");
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
      <div className="shrink-0 rounded-xl border border-border bg-white p-2">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`QR code for pairing your phone with this computer, address ${address}`}
          width={QR_SIZE}
          height={QR_SIZE}
          className="block"
          data-testid="pairing-qr"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-center sm:text-left">
        <p className="text-sm font-medium text-foreground">Scan from Timely on your phone</p>
        <p className="text-xs text-muted-foreground">
          Open Timely on your phone, choose “Connect to my computer” and point the camera at this
          code. You can also type the address below by hand.
        </p>
        <code
          className="block truncate rounded-lg bg-muted/60 px-3 py-2 text-left font-mono text-xs text-foreground"
          title={address}
          data-testid="pairing-address"
        >
          {address}
        </code>
        {urls.length > 1 && (
          <p className="text-[11px] text-muted-foreground">
            The phone also tries: {urls.slice(1).join(", ")}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <button type="button" onClick={() => void copy()} className={secondaryButton}>
            {copied === "done" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied === "done" ? "Copied" : "Copy address"}
          </button>
          <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {copied === "done" && "Address copied to the clipboard."}
            {copied === "failed" && "Could not copy. Select the address and copy it by hand."}
          </span>
        </div>
        {renderError && <p className="text-xs text-destructive">{renderError}</p>}
      </div>
    </div>
  );
}
