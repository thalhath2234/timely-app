/** An error with the server's message and, when it sent one, its stable
 * `code` (such as PROVIDER_NOT_CHOSEN), so a screen can offer the fix. */
export type CodedError = Error & { code?: string };

/** Reads a failed response's `{message, code}` body into a CodedError. */
export async function codedError(res: Response, fallback: string): Promise<CodedError> {
  let message = fallback;
  let code: string | undefined;
  try {
    const data = await res.json();
    if (typeof data?.message === "string") message = data.message;
    if (typeof data?.code === "string") code = data.code;
  } catch {
    // keep the fallback message
  }
  const error: CodedError = new Error(message);
  error.code = code;
  return error;
}

export const errorCode = (err: unknown): string | undefined =>
  err && typeof err === "object" && "code" in err && typeof err.code === "string" ? err.code : undefined;
