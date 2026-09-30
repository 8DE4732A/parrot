/**
 * Step 6：发布素材包到线上 DB（详设 §3.2 Step 6）
 * - 幂等 upsert：decks / words / deck_words（重建）/ word_relations / word_explanations
 * - 覆盖边界：word_explanations 仅覆盖 origin='pipeline' 行
 * - 用户域表零接触
 * 前置：DATABASE_URL 指向目标库；素材包已通过 validatePackage
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";

import { validatePackage } from "../materials/schema";
import { deckWords, decks, wordExplanations, wordRelations, words } from "../src/lib/schema";
import type { WordEntry } from "../materials/schema/word";
import type { RelationEntry } from "../materials/schema/relation";
import type { ExplanationEntry } from "../materials/schema/explanation";

const DECK = process.argv[2] ?? "ielts";
const MATERIALS = path.resolve(__dirname, "..", "materials", DECK);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ 未配置 DATABASE_URL（Neon）——publish 需要线上库，详见 README");
    process.exit(1);
  }
  const issues = validatePackage(MATERIALS);
  if (issues.length > 0) {
    console.error(`❌ 素材包未通过校验，拒绝发布：${issues.length} 个问题`);
    for (const i of issues.slice(0, 10)) console.error(`   [规则${i.rule}] ${i.message}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(path.join(MATERIALS, "manifest.json"), "utf-8"));
  const wordEntries: WordEntry[] = JSON.parse(readFileSync(path.join(MATERIALS, "words.json"), "utf-8"));
  const relationEntries: RelationEntry[] = JSON.parse(
    readFileSync(path.join(MATERIALS, "relations.json"), "utf-8")
  );
  const explanationEntries: ExplanationEntry[] = JSON.parse(
    readFileSync(path.join(MATERIALS, "explanations.json"), "utf-8")
  );

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);
  const stats = { wordsInserted: 0, wordsUpdated: 0, relations: 0, explanations: 0 };

  // 1. decks upsert
  const existingDecks = await db.select().from(decks).where(eq(decks.slug, DECK));
  let deckId: number;
  if (existingDecks.length > 0) {
    deckId = existingDecks[0].id;
    await db
      .update(decks)
      .set({
        name: manifest.deck.name,
        description: manifest.deck.description,
        exam: manifest.deck.exam,
        defaultDailyNewLimit: manifest.deck.defaultDailyNewLimit,
        displayOrder: manifest.deck.order,
      })
      .where(eq(decks.id, deckId));
  } else {
    const [inserted] = await db
      .insert(decks)
      .values({
        slug: DECK,
        name: manifest.deck.name,
        description: manifest.deck.description,
        exam: manifest.deck.exam,
        defaultDailyNewLimit: manifest.deck.defaultDailyNewLimit,
        displayOrder: manifest.deck.order,
      })
      .returning({ id: decks.id });
    deckId = inserted.id;
  }
  console.log(`decks: slug=${DECK} id=${deckId}`);

  // 2. words upsert（不删除孤儿词）
  const wordIdMap = new Map<string, number>();
  for (const [i, w] of wordEntries.entries()) {
    const values = {
      word: w.word,
      phonetic: w.phonetic,
      translation: w.translation,
      definition: w.definition,
      pos: w.pos,
      bnc: w.frequency?.bnc,
      frq: w.frequency?.frq,
      inflections: w.inflections,
      source: w.source,
    };
    const existing = await db.select({ id: words.id }).from(words).where(eq(words.word, w.word));
    if (existing.length > 0) {
      wordIdMap.set(w.word.toLowerCase(), existing[0].id);
      await db.update(words).set(values).where(eq(words.id, existing[0].id));
      stats.wordsUpdated++;
    } else {
      const [inserted] = await db.insert(words).values(values).returning({ id: words.id });
      wordIdMap.set(w.word.toLowerCase(), inserted.id);
      stats.wordsInserted++;
    }
    if ((i + 1) % 500 === 0) console.log(`  words 进度 ${i + 1}/${wordEntries.length}`);
  }

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
  for (const r of relationEntries) {
    const from = wordIdMap.get(r.word.toLowerCase());
    const to = wordIdMap.get(r.related.toLowerCase());
    if (!from || !to) continue;
    await db.insert(wordRelations).values({ wordId: from, relatedWordId: to, relation: r.relation })
      .onConflictDoNothing();
    stats.relations++;
  }
  console.log(`word_relations: ${stats.relations} 条`);

  // 5. word_explanations upsert（仅覆盖 origin='pipeline' 行）
  for (const e of explanationEntries) {
    const wordId = wordIdMap.get(e.word.toLowerCase());
    if (!wordId) continue;
    await db
      .insert(wordExplanations)
      .values({
        wordId,
        model: e.model,
        status: "ready",
        content: e.content,
        promptTokens: e.tokens?.prompt,
        completionTokens: e.tokens?.completion,
        origin: "pipeline",
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: wordExplanations.wordId,
        set: {
          model: e.model,
          status: "ready",
          content: e.content,
          promptTokens: e.tokens?.prompt,
          completionTokens: e.tokens?.completion,
          origin: "pipeline",
          generatedAt: new Date(),
        },
        where: eq(wordExplanations.origin, "pipeline"), // 只覆盖管线生成的行，不动用户在线生成的
      });
    stats.explanations++;
  }
  console.log(`word_explanations: ${stats.explanations} 条（仅覆盖 pipeline 行）`);

  console.log(
    `✅ 发布完成：words +${stats.wordsInserted} ~${stats.wordsUpdated}，deck_words ${wordEntries.length}，relations ${stats.relations}，explanations ${stats.explanations}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
