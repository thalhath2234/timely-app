/**
 * Device unlock for host cards and Full Access (phase 5, Q-5.7): before the
 * phone sends Run once, Allow for this chat or a Full Access step-up it asks
 * for the person's fingerprint, face or screen lock. The server cannot check
 * this (it only records `device.unlocked`), so the app is the gate: a failed
 * or cancelled unlock sends nothing. Deny never asks.
 *
 * The platform module is loaded on first use, so Node tests import this file
 * without it and pass their own `Authenticator`.
 */

/** What the platform can do; `expo-local-authentication` fits it. */
export type Authenticator = {
  /** A fingerprint, face or screen lock is set up on this device. */
  available: () => Promise<boolean>;
  /** Shows the system prompt; true once the person passed it. */
  authenticate: (prompt: string) => Promise<{ ok: true } | { ok: false; cancelled: boolean }>;
};

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "failed" | "unavailable"; message: string };

export const UNLOCK_PROMPT = "Approve this for your assistant";
export const UNLOCK_UNAVAILABLE = "Set a screen lock on this phone to approve here.";
export const UNLOCK_FAILED = "Couldn't unlock this phone, so nothing was sent.";
export const UNLOCK_CANCELLED = "Unlock cancelled, so nothing was sent.";

async function platformAuthenticator(): Promise<Authenticator> {
  const LocalAuthentication = await import("expo-local-authentication");
  return {
    available: async () => {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      return level !== LocalAuthentication.SecurityLevel.NONE;
    },
    authenticate: async (prompt) => {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: prompt,
        cancelLabel: "Cancel",
        // Biometric or the device's own code: the person's lock, whichever they use.
        disableDeviceFallback: false,
      });
      if (result.success) return { ok: true };
      return { ok: false, cancelled: result.error === "user_cancel" || result.error === "system_cancel" || result.error === "app_cancel" };
    },
  };
}

/** Asks the person to unlock the phone. Never throws: a broken module is "unavailable". */
export async function unlockDevice(prompt: string = UNLOCK_PROMPT, auth?: Authenticator): Promise<UnlockResult> {
  try {
    const a = auth ?? (await platformAuthenticator());
    if (!(await a.available())) return { ok: false, reason: "unavailable", message: UNLOCK_UNAVAILABLE };
    const result = await a.authenticate(prompt);
    if (result.ok) return { ok: true };
    return result.cancelled
      ? { ok: false, reason: "cancelled", message: UNLOCK_CANCELLED }
      : { ok: false, reason: "failed", message: UNLOCK_FAILED };
  } catch {
    return { ok: false, reason: "unavailable", message: UNLOCK_UNAVAILABLE };
  }
}

/**
 * Runs `send` only after the person unlocked the phone, or at once when
 * `needsUnlock` is false (Deny). A refused unlock returns its message and
 * `send` never runs; `send` gets `unlocked`, which goes in the request's device.
 */
export async function withUnlock<T>(
  needsUnlock: boolean,
  send: (unlocked: boolean) => Promise<T>,
  unlock: (prompt?: string) => Promise<UnlockResult> = unlockDevice,
): Promise<{ sent: true; value: T } | { sent: false; message: string }> {
  if (!needsUnlock) return { sent: true, value: await send(false) };
  const result = await unlock();
  if (!result.ok) return { sent: false, message: result.message };
  return { sent: true, value: await send(true) };
}
