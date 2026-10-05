import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The monorepo keeps one .env at the repo root, and Next.js only reads env
// files from this directory. Values already in the environment win.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rootEnvFile = path.join(repoRoot, ".env");
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const apiOrigin = process.env.API_ORIGIN || "http://localhost:8080";
const electronBuild = process.env.ELECTRON_BUILD === "1";

const nextConfig: NextConfig = {
  ...(electronBuild
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: repoRoot,
      }
    : {}),
  // Extra dev hosts (e.g. a tunnel) come from DEV_ORIGINS, comma-separated.
  allowedDevOrigins: [
    "127.0.0.1",
    ...(process.env.DEV_ORIGINS ?? "").split(",").map((host) => host.trim()).filter(Boolean),
  ],
  async rewrites() {
    // A rewrite is baked into the standalone output, so the desktop app (whose
    // API port is chosen at runtime) uses app/api-proxy/[...path]/route.ts
    // instead; everything else keeps the cheaper rewrite.
    if (electronBuild) return [];
    return [
      {
        source: "/api-proxy/:path*",
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
