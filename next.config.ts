import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {"/*":["./data/**/*","./tmp/**/*","./output/**/*","./outputs/**/*","./work/**/*","./research/**/*","./release/**/*","./.git/**/*"]},
  serverExternalPackages: ["adm-zip", "mammoth", "pdf-parse", "@whiskeysockets/baileys", "pino"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  images: { unoptimized: true },
  // 允许 Codex 预览使用 127.0.0.1 访问开发服务器，避免页面停留在旧缓存。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
