import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Drizzle driver（PGlite wasm / Neon HTTP）保持外部化，避免 bundler 破坏其资源路径
  serverExternalPackages: ["@electric-sql/pglite", "drizzle-orm/pglite", "@neondatabase/serverless"],
};

export default nextConfig;
