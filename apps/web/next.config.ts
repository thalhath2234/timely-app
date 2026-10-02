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
  allowedDevOrigins: [
    "11a5-2405-1204-c198-100-7700-a5ae-3ecc-d52c.ngrok-free.app",
    "7b74-2405-1204-c198-100-7700-a5ae-3ecc-d52c.ngrok-free.app",
    "*.ngrok-free.app",
    "127.0.0.1",
  ],
  async rewrites() {
    return [
      {
        source: "/api-proxy/:path*",
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
