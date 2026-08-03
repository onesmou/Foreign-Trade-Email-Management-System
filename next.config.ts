import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["adm-zip", "mammoth", "pdf-parse"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  images: { unoptimized: true },
};

export default nextConfig;
