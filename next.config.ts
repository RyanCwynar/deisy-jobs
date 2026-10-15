import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Set STANDALONE=1 for Docker image builds
  ...(process.env.STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
