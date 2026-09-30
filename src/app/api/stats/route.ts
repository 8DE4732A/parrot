import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSchema } from "@/lib/ensure-schema";
import { cardProgress, deckWords, decks, reviewLogs, quizRecords, userDecks } from "@/lib/schema";

/** GET /api/stats — 统计（详设 §5.5） */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  await ensureSchema();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 今日完成数
  const todayDone = await db.$count(
    reviewLogs,
    and(eq(reviewLogs.userId, user.id), gte(reviewLogs.reviewedAt, todayStart))
  );

  // 连续打卡（按日去重的复习记录，从今天往前数）
  const dayRows = await db
    .select({ day: sql<string>`to_char(${reviewLogs.reviewedAt}, 'YYYY-MM-DD')` })
    .from(reviewLogs)
    .where(eq(reviewLogs.userId, user.id))
    .groupBy(sql`1`);
  const daySet = new Set(dayRows.map((r) => r.day));
  let streakDays = 0;
  const cursor = new Date();
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    streakDays++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // 词书进度
  const activeDecks = await db
    .select({ deckId: userDecks.deckId })
    .from(userDecks)
    .where(and(eq(userDecks.userId, user.id), eq(userDecks.active, true)));
  const deckProgress = [];
  for (const { deckId } of activeDecks) {
    const deck = (await db.select().from(decks).where(eq(decks.id, deckId)))[0];
    const dw = await db
      .select({ wordId: deckWords.wordId })
      .from(deckWords)
      .where(eq(deckWords.deckId, deckId));
    const cp = await db
      .select({ wordId: cardProgress.wordId })
      .from(cardProgress)
      .where(eq(cardProgress.userId, user.id));
    const learnedSet = new Set(cp.map((c) => c.wordId));
    deckProgress.push({
      slug: deck?.slug ?? "",
      name: deck?.name ?? "",
      learned: dw.filter((r) => learnedSet.has(r.wordId)).length,
      total: dw.length,
    });
  }

  // 未来 7 天到期分布
  const dueRows = await db
    .select({ due: cardProgress.due })
    .from(cardProgress)
    .where(eq(cardProgress.userId, user.id));
  const dueNext7Days = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date(todayStart);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    return dueRows.filter((r) => {
      const t = new Date(r.due).getTime();
      return t >= dayStart.getTime() && t <= dayEnd.getTime();
    }).length;
  });

  // 测验正确率（按题型）
  const quizRows = await db
    .select({ type: quizRecords.type, correct: quizRecords.correct })
    .from(quizRecords)
    .where(eq(quizRecords.userId, user.id));
  const quizAccuracyByType: Record<string, { correct: number; total: number }> = {};
  for (const r of quizRows) {
    quizAccuracyByType[r.type] ??= { correct: 0, total: 0 };
    quizAccuracyByType[r.type].total++;
    if (r.correct) quizAccuracyByType[r.type].correct++;
  }

  return NextResponse.json({
    todayDone,
    streakDays,
    deckProgress,
    dueNext7Days,
    quizAccuracyByType,
  });
}
