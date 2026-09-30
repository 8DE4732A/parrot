/**
 * Step 6：发布素材包到线上 DB（详设 §3.2 Step 6）
 * - 幂等 upsert：decks / words / deck_words（重建）/ word_relations / word_explanations
 * - 覆盖边界：word_explanations 仅覆盖 origin='pipeline' 行
 * - 用户域表零接触
 * 前置：DATABASE_URL 指向目标库；素材包已通过 validatePackage
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, inArray } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";

import { validatePackage } from "../materials/schema";
import { deckWords, decks, wordExplanations, wordRelations, words } from "../src/lib/schema";
import type { WordEntry } from "../materials/schema/word";
import type { RelationEntry } from "../materials/schema/relation";
import type { ExplanationEntry } from "../materials/schema/explanation";

const DECK = process.argv[2] ?? "ielts";
const MATERIALS = path.resolve(__dirname, "..", "materials", DECK);

async function main() {
  const devMode = process.argv.includes("--dev");
  // 本地（无 DATABASE_URL）：发布到 PGLite 开发库；生产：Neon
  // （与 src/lib/db.ts 同一套 driver 切换策略）
  // 类型基准：以 PGLite driver 为准，Neon driver 的查询 API 同构
  const baseDb = drizzle(new PGlite(":memory:"));
  let db: typeof baseDb;
  const target: string = process.env.DATABASE_URL ? "Neon" : "PGLite(本地)";
  if (process.env.DATABASE_URL) {
    const { drizzle: drizzleNeon } = await import("drizzle-orm/neon-http");
    const { neon } = await import("@neondatabase/serverless");
    db = drizzleNeon(neon(process.env.DATABASE_URL)) as unknown as typeof baseDb;
  } else {
    const pg = new PGlite(".pglite");
    // 本地库首次发布时建表（exec 支持多语句 DDL）
    const { DDL } = await import("../src/lib/ensure-schema");
    await pg.exec(DDL);
    db = drizzle(pg);
  }

  if (!devMode) {
    const issues = validatePackage(MATERIALS);
    if (issues.length > 0) {
      console.error(`❌ 素材包未通过校验，拒绝发布：${issues.length} 个问题`);
      for (const i of issues.slice(0, 10)) console.error(`   [规则${i.rule}] ${i.message}`);
      process.exit(1);
    }
  } else {
    console.log("⚠️ --dev 模式：跳过全量校验（仅限本地开发库，讲解可部分覆盖）");
  }

  // deck 元信息：生产读 manifest；dev 模式 manifest 可能未打包，用 fallback
  let deckMeta: { name: string; description?: string; exam: string; defaultDailyNewLimit: number; order: number };
  try {
    const manifest = JSON.parse(readFileSync(path.join(MATERIALS, "manifest.json"), "utf-8"));
    deckMeta = manifest.deck;
  } catch {
    deckMeta = {
      name: "雅思核心词汇（dev）",
      description: "本地开发数据",
      exam: "IELTS",
      defaultDailyNewLimit: 10,
      order: 1,
    };
    if (!devMode) throw new Error("manifest.json 缺失——请先跑 package-materials.ts");
  }
  const wordEntries: WordEntry[] = JSON.parse(readFileSync(path.join(MATERIALS, "words.json"), "utf-8"));
  const relationEntries: RelationEntry[] = JSON.parse(
    readFileSync(path.join(MATERIALS, "relations.json"), "utf-8")
  );
  const explanationEntries: ExplanationEntry[] = JSON.parse(
    readFileSync(path.join(MATERIALS, "explanations.json"), "utf-8")
  );

  const stats = { wordsInserted: 0, wordsUpdated: 0, relations: 0, explanations: 0 };

  // 1. decks upsert
  const existingDecks = await db.select().from(decks).where(eq(decks.slug, DECK));
  let deckId: number;
  if (existingDecks.length > 0) {
    deckId = existingDecks[0].id;
    await db
      .update(decks)
      .set({
        name: deckMeta.name,
        description: deckMeta.description,
        exam: deckMeta.exam,
        defaultDailyNewLimit: deckMeta.defaultDailyNewLimit,
        displayOrder: deckMeta.order,
      })
      .where(eq(decks.id, deckId));
  } else {
    const [inserted] = await db
      .insert(decks)
      .values({
        slug: DECK,
        name: deckMeta.name,
        description: deckMeta.description,
        exam: deckMeta.exam,
        defaultDailyNewLimit: deckMeta.defaultDailyNewLimit,
        displayOrder: deckMeta.order,
      })
      .returning({ id: decks.id });
    deckId = inserted.id;
  }
  console.log(`decks: slug=${DECK} id=${deckId}`);

  // 2. words 批量 upsert（不删除孤儿词）：一次载入现有映射，缺的分块 insert，余下分块 update
  const wordIdMap = new Map<string, number>();
  const existingAll = await db.select({ id: words.id, word: words.word }).from(words);
  for (const r of existingAll) wordIdMap.set(r.word.toLowerCase(), r.id);

  const toInsert = wordEntries.filter((w) => !wordIdMap.has(w.word.toLowerCase()));
  const toUpdate = wordEntries.filter((w) => wordIdMap.has(w.word.toLowerCase()));

  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const inserted = await db
      .insert(words)
      .values(
        chunk.map((w) => ({
          word: w.word,
          phonetic: w.phonetic,
          translation: w.translation,
          definition: w.definition,
          pos: w.pos,
          bnc: w.frequency?.bnc,
          frq: w.frequency?.frq,
          inflections: w.inflections,
          source: w.source,
        }))
      )
      .returning({ id: words.id, word: words.word });
    for (const r of inserted) wordIdMap.set(r.word.toLowerCase(), r.id);
    stats.wordsInserted += inserted.length;
    console.log(`  words 插入进度 ${Math.min(i + CHUNK, toInsert.length)}/${toInsert.length}`);
  }
  for (const w of toUpdate) {
    await db
      .update(words)
      .set({
        phonetic: w.phonetic,
        translation: w.translation,
        definition: w.definition,
        pos: w.pos,
        bnc: w.frequency?.bnc,
        frq: w.frequency?.frq,
        inflections: w.inflections,
        source: w.source,
      })
      .where(eq(words.id, wordIdMap.get(w.word.toLowerCase())!));
    stats.wordsUpdated++;
  }
  console.log(`  words 更新 ${toUpdate.length}`);

  // 3. deck_words 重建
  await db.delete(deckWords).where(eq(deckWords.deckId, deckId));
  await db.insert(deckWords).values(
    wordEntries.map((w, ord) => ({
      deckId,
      wordId: wordIdMap.get(w.word.toLowerCase())!,
      ord,
    }))
  );
  console.log(`deck_words: 重建 ${wordEntries.length} 行`);

  // 4. word_relations upsert（双向在素材包中已各存一行）
  const relRows = relationEntries.flatMap((r) => {
    const from = wordIdMap.get(r.word.toLowerCase());
    const to = wordIdMap.get(r.related.toLowerCase());
    if (!from || !to) return [];
    return [{ wordId: from, relatedWordId: to, relation: r.relation }];
  });
  for (let i = 0; i < relRows.length; i += CHUNK) {
    await db.insert(wordRelations).values(relRows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
  stats.relations = relRows.length;
  console.log(`word_relations: ${stats.relations} 条`);

  // 5. word_explanations upsert（仅覆盖 origin='pipeline' 行）
  const expRows = explanationEntries.flatMap((e) => {
    const wordId = wordIdMap.get(e.word.toLowerCase());
    if (!wordId) return [];
    return [{
      wordId,
      model: e.model,
      status: "ready",
      content: e.content,
      promptTokens: e.tokens?.prompt ?? null,
      completionTokens: e.tokens?.completion ?? null,
      origin: "pipeline",
      generatedAt: new Date(),
    }];
  });
  // 覆盖边界：只替换 origin='pipeline' 的行，不动用户在线生成（client/server）
  const pipelineWordIds = expRows.map((r) => r.wordId);
  for (let i = 0; i < pipelineWordIds.length; i += CHUNK) {
    const ids = pipelineWordIds.slice(i, i + CHUNK);
    await db.delete(wordExplanations).where(
      and(inArray(wordExplanations.wordId, ids), eq(wordExplanations.origin, "pipeline"))
    );
  }
  for (let i = 0; i < expRows.length; i += CHUNK) {
    await db.insert(wordExplanations).values(expRows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
  stats.explanations = expRows.length;
  console.log(`word_explanations: ${stats.explanations} 条（仅覆盖 pipeline 行）`);

  console.log(
    `✅ 发布完成 [${target}]：words +${stats.wordsInserted} ~${stats.wordsUpdated}，deck_words ${wordEntries.length}，relations ${stats.relations}，explanations ${stats.explanations}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
