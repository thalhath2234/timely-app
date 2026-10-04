// Append-only file logs for the supervisor and its sidecars. Electron-free.
import { closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, writeSync } from "node:fs";
import path from "node:path";

export const ROTATE_BYTES = 5 * 1024 * 1024;

export type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** Raw sidecar output; written without a level prefix. */
  raw(chunk: string | Buffer): void;
  child(prefix: string): Logger;
  close(): void;
};

/**
 * One log file with size-based rotation: when the file passes `rotateBytes`
 * it is renamed to `<file>.1` (replacing the previous `.1`) and a fresh file
 * is started. Writes are synchronous so nothing is lost when the process dies.
 */
export class FileLog {
  private fd: number | null = null;
  private size = 0;
  readonly file: string;
  private readonly echo?: (chunk: string) => void;
  private readonly rotateBytes: number;

  constructor(file: string, echo?: (chunk: string) => void, rotateBytes = ROTATE_BYTES) {
    this.file = file;
    this.echo = echo;
    this.rotateBytes = rotateBytes;
  }

  private open() {
    if (this.fd !== null) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    this.size = existsSync(this.file) ? statSync(this.file).size : 0;
    this.fd = openSync(this.file, "a");
  }

  private rotate() {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
    try {
      renameSync(this.file, `${this.file}.1`);
    } catch {
      // Nothing to rotate; keep appending to a new file.
    }
    this.open();
  }

  write(chunk: string | Buffer) {
    const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    try {
      this.open();
      if (this.size + data.length > this.rotateBytes) this.rotate();
      if (this.fd !== null) {
        writeSync(this.fd, data);
        this.size += data.length;
      }
    } catch {
      // Logging must never take the app down.
    }
    if (this.echo) this.echo(data.toString());
  }

  close() {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

export function createLogger(file: string, options: { echo?: (chunk: string) => void; prefix?: string } = {}): Logger {
  const log = new FileLog(file, options.echo);
  return loggerFor(log, options.prefix ?? "");
}

function loggerFor(log: FileLog, prefix: string): Logger {
  const line = (level: string, message: string) =>
    log.write(`${new Date().toISOString()} [${level}]${prefix ? ` [${prefix}]` : ""} ${message}\n`);
  return {
    info: (m) => line("info", m),
    warn: (m) => line("warn", m),
    error: (m) => line("error", m),
    raw: (chunk) => log.write(chunk),
    child: (childPrefix) => loggerFor(log, prefix ? `${prefix}:${childPrefix}` : childPrefix),
    close: () => log.close(),
  };
}

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  raw() {},
  child() {
    return silentLogger;
  },
  close() {},
};
