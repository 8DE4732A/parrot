/**
 * 每日队列计算（详设 §8 队列 SQL 语义）
 * reviews：state != New 且 due <= 今天 23:59:59，按 due 升序
 * news：active 词书未学词，按词书添加序 + ord，每书 dailyNewLimit
 */
import { and, asc, eq, inArray, ne, lte } from "drizzle-orm";

import { db } from "./db";
import { cardProgress, deckWords, userDecks, wordExplanations, words } from "./schema";

export interface QueueWord {
  wordId: number;
  word: string;
  phonetic: string | null;
  translation: string;
  card: {
    state: number;
    due: string;
    stability: number;
    difficulty: number;
    reps: number;
    lapses: number;
  } | null;
  explanation: unknown | null;
  explanationStatus: string | null;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export async function getDailyQueue(userId: number): Promise<{
  reviews: QueueWord[];
  news: QueueWord[];
}> {
  const eod = endOfToday();

  // ---- 复习队列 ----
  const reviewRows = await db
    .select({
      wordId: words.id,
      word: words.word,
      phonetic: words.phonetic,
      translation: words.translation,
      state: cardProgress.state,
      due: cardProgress.due,
      stability: cardProgress.stability,
      difficulty: cardProgress.difficulty,
      reps: cardProgress.reps,
      lapses: cardProgress.lapses,
    })
    .from(cardProgress)
    .innerJoin(words, eq(words.id, cardProgress.wordId))
    .where(
      and(
        eq(cardProgress.userId, userId),
        ne(cardProgress.state, 0),
        lte(cardProgress.due, eod)
      )
    )
    .orderBy(asc(cardProgress.due));

  // ---- 新词队列 ----
  const activeDecks = await db
    .select({ deckId: userDecks.deckId, limit: userDecks.dailyNewLimit })
    .from(userDecks)
    .where(and(eq(userDecks.userId, userId), eq(userDecks.active, true)));

  const newsRows: (typeof reviewRows) = [];
  for (const { deckId, limit } of activeDecks) {
    const rows = await db
      .select({
        wordId: words.id,
        word: words.word,
        phonetic: words.phonetic,
        translation: words.translation,
      })
      .from(deckWords)
      .innerJoin(words, eq(words.id, deckWords.wordId))
      .where(eq(deckWords.deckId, deckId))
      .orderBy(asc(deckWords.ord));

    if (rows.length === 0) continue;
    const learned = await db
      .select({ wordId: cardProgress.wordId })
      .from(cardProgress)
      .where(
        and(
          eq(cardProgress.userId, userId),
          inArray(
            cardProgress.wordId,
            rows.map((r) => r.wordId)
          )
        )
      );
    const learnedSet = new Set(learned.map((l) => l.wordId));
    const fresh = rows.filter((r) => !learnedSet.has(r.wordId)).slice(0, limit);
    newsRows.push(...fresh.map((r) => ({ ...r, state: 0, due: new Date(), stability: 0, difficulty: 0, reps: 0, lapses: 0 })));
  }

  // ---- 讲解批量取 ----
  const allWords = [...reviewRows, ...newsRows];
  const explanationMap = new Map<number, { content: unknown; status: string }>();
  if (allWords.length > 0) {
    const exps = await db
      .select({ wordId: wordExplanations.wordId, content: wordExplanations.content, status: wordExplanations.status })
      .from(wordExplanations)
      .where(
        and(
          eq(wordExplanations.status, "ready"),
          inArray(
            wordExplanations.wordId,
            allWords.map((w) => w.wordId)
          )
        )
      );
    for (const e of exps) explanationMap.set(e.wordId, { content: e.content, status: e.status });
  }

  const withExplanation = <T extends { wordId: number }>(rows: T[]) =>
    rows.map((r) => {
      const exp = explanationMap.get(r.wordId);
      return {
        ...r,
        explanation: exp?.content ?? null,
        explanationStatus: exp?.status ?? null,
      };
    });

  const reviews = withExplanation(reviewRows).map((r) => ({
    wordId: r.wordId,
    word: r.word,
    phonetic: r.phonetic,
    translation: r.translation,
    card: { state: r.state, due: r.due.toISOString(), stability: r.stability, difficulty: r.difficulty, reps: r.reps, lapses: r.lapses },
    explanation: r.explanation,
    explanationStatus: r.explanationStatus,
  }));

  const news = withExplanation(newsRows).map((r) => ({
    wordId: r.wordId,
    word: r.word,
    phonetic: r.phonetic,
    translation: r.translation,
    card: null,
    explanation: r.explanation,
    explanationStatus: r.explanationStatus,
  }));

  return { reviews, news };
}
