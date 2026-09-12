import type { NextConfig } from "next";

const apiOrigin = process.env.API_ORIGIN || "http://localhost:8080";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "11a5-2405-1204-c198-100-7700-a5ae-3ecc-d52c.ngrok-free.app",
    "7b74-2405-1204-c198-100-7700-a5ae-3ecc-d52c.ngrok-free.app",
    "*.ngrok-free.app",
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
