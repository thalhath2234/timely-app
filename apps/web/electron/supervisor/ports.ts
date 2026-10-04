// Loopback port allocation for the sidecars. Electron-free.
import net from "node:net";

export const LOOPBACK = "127.0.0.1";

/** Binds `port` on `host` briefly and resolves the port actually bound (0 = ephemeral). */
export function listenPort(port: number, host = LOOPBACK): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Failed to allocate a TCP port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

export async function isPortFree(port: number, host = LOOPBACK): Promise<boolean> {
  try {
    await listenPort(port, host);
    return true;
  } catch {
    return false;
  }
}

/** The preferred port when it is free, otherwise an ephemeral one. */
export async function findFreePort(preferred: number, host = LOOPBACK): Promise<number> {
  try {
    return await listenPort(preferred, host);
  } catch {
    return listenPort(0, host);
  }
}

export type PortSet = { postgresPort: number; apiPort: number; webPort: number };

/**
 * Re-validates persisted ports on boot. A port that someone else now holds is
 * replaced. The Postgres port is only re-checked when `postgresOwned` is false
 * (i.e. no live postmaster of ours still holds it); a live one keeps its port
 * so the caller can reuse or stop it.
 */
export async function reconcilePorts(
  persisted: PortSet,
  options: { postgresOwned: boolean; probe?: (port: number) => Promise<boolean>; pick?: (preferred: number) => Promise<number> } = {
    postgresOwned: false,
  },
): Promise<{ ports: PortSet; changed: boolean }> {
  const probe = options.probe ?? ((port) => isPortFree(port));
  const pick = options.pick ?? ((preferred) => findFreePort(preferred));
  const ports: PortSet = { ...persisted };
  let changed = false;
  const taken = new Set<number>();

  async function settle(key: keyof PortSet, skip: boolean) {
    const current = ports[key];
    if (skip) {
      taken.add(current);
      return;
    }
    if (!taken.has(current) && (await probe(current))) {
      taken.add(current);
      return;
    }
    let next = await pick(current);
    while (taken.has(next)) next = await pick(0);
    ports[key] = next;
    taken.add(next);
    changed = true;
  }

  await settle("postgresPort", options.postgresOwned);
  await settle("apiPort", false);
  await settle("webPort", false);
  return { ports, changed };
}
