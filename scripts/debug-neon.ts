/** 调试：查 Neon 数据 */
import { eq, count, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import "./lib/env";
import { words } from "../src/lib/schema";

async function main() {
  const db = drizzle(neon(process.env.DATABASE_URL!));
  const total = await db.select({ n: count() }).from(words);
  const us = await db.select({ n: count() }).from(words).where(isNotNull(words.phoneticUs));
  console.log(`Neon words: ${total[0].n}，含美音标: ${us[0].n}`);
  const s = await db.select().from(words).where(eq(words.word, "schedule"));
  console.log("schedule:", s[0]?.phonetic, "| US:", s[0]?.phoneticUs);
  process.exit(0);
}
main();
