/**
 * Drizzle 客户端：按环境切换 driver（详设 §10.2）
 * - 有 DATABASE_URL：Neon serverless HTTP driver（生产）
 * - 无 DATABASE_URL：PGlite 嵌入式 Postgres（本地开发，数据落 .pglite/ 目录）
 * 同一套 schema（src/lib/schema.ts），引擎代码无感。
 */
import { createRequire } from "node:module";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const require_ = createRequire(import.meta.url);

function create(): { db: PgDatabase<PgQueryResultHKT, typeof schema>; client: unknown } {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = neon(url);
    return {
      db: drizzleNeon(client, { schema }) as unknown as PgDatabase<PgQueryResultHKT, typeof schema>,
      client,
    };
  }
  const { drizzle: drizzlePglite } =
    require_("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
  const { PGlite } = require_("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const client = new PGlite(".pglite");
  return {
    db: drizzlePglite(client, { schema }) as unknown as PgDatabase<PgQueryResultHKT, typeof schema>,
    client,
  };
}

export const { db, client } = create();
export default db;
