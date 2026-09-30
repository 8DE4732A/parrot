import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// 加载 .env.local（shell source 无法处理含 & 的 URL）
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
