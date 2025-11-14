import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ensure proper handling of native modules for lightningcss
  experimental: {
    serverComponentsExternalPackages: ["lightningcss"],
  },
};

export default nextConfig;
