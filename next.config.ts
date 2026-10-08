import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // GitHub Pages can only serve the static export. Local `next dev` keeps the API routes.
  ...(process.env.PAGES_EXPORT === "1" ? { output: "export" as const } : {}),
};

export default nextConfig;
