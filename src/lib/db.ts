/**
 * Drizzle 客户端：按环境切换 driver（详设 §10.2）
 * - 有 DATABASE_URL：neon-serverless（WebSocket Pool）——支持 db.transaction()，
 *   用户域评分/测验写路径的原子提交依赖它（neon-http 不支持事务，P0 评审结论）
 * - 无 DATABASE_URL：PGlite 嵌入式 Postgres（本地开发，原生支持事务）
 * 同一套 schema（src/lib/schema.ts），引擎代码无感。
 */
import { createRequire } from "node:module";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleNeonServerless } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

const require_ = createRequire(import.meta.url);

function create(): { db: PgDatabase<PgQueryResultHKT, typeof schema>; client: unknown } {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = new Pool({ connectionString: url });
    return {
      db: drizzleNeonServerless(client, { schema }) as unknown as PgDatabase<
        PgQueryResultHKT,
        typeof schema
      >,
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
