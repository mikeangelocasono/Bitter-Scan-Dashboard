import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ensure proper handling of native modules for lightningcss
  serverExternalPackages: ["lightningcss"],
};

export default nextConfig;
