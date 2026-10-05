import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Drizzle driver（PGlite wasm / Neon WebSocket）保持外部化，避免 bundler 破坏其资源路径
  serverExternalPackages: ["@electric-sql/pglite", "drizzle-orm/pglite", "@neondatabase/serverless"],
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    // CSP 权衡（P4 评审）：connect-src 放开 https: —— BYOK 用户自配任意 LLM 端点
    // 是设计使然，无法白名单化；XSS 的主要防线是 script-src 收紧 + frame-ancestors
    const csp = [
      "default-src 'self'",
      // Next.js 无 nonce 方案下 'unsafe-inline' 是标准妥协；dev 追加 'unsafe-eval'（HMR）
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https://*.githubusercontent.com data:",
      // 音频经 jsDelivr CDN（P2）
      "media-src 'self' https://cdn.jsdelivr.net",
      "connect-src 'self' https: wss:",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
