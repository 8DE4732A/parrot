import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSchema } from "@/lib/ensure-schema";
import { cardProgress, deckWords, decks, userDecks } from "@/lib/schema";

/** GET /api/decks — 词书列表 + 当前用户进度 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  await ensureSchema();

  const allDecks = await db.select().from(decks).orderBy(decks.displayOrder);
  const mine = await db.select().from(userDecks).where(eq(userDecks.userId, user.id));
  const mineMap = new Map(mine.map((m) => [m.deckId, m]));
  const learnedRows = await db
    .select({ wordId: cardProgress.wordId })
    .from(cardProgress)
    .where(eq(cardProgress.userId, user.id));
  const learnedSet = new Set(learnedRows.map((r) => r.wordId));

  const result = [];
  for (const d of allDecks) {
    const deckWordRows = await db
      .select({ wordId: deckWords.wordId })
      .from(deckWords)
      .where(eq(deckWords.deckId, d.id));
    const ud = mineMap.get(d.id);
    result.push({
      slug: d.slug,
      name: d.name,
      description: d.description,
      exam: d.exam,
      wordCount: deckWordRows.length,
      active: ud?.active ?? false,
      dailyNewLimit: ud?.dailyNewLimit ?? d.defaultDailyNewLimit,
      learnedCount: deckWordRows.filter((r) => learnedSet.has(r.wordId)).length,
    });
  }
  return NextResponse.json({ decks: result });
}

/** POST /api/decks — 激活词书（幂等） */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  await ensureSchema();

  const body = (await req.json()) as { slug?: string; dailyNewLimit?: number };
  if (!body.slug) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "slug 必填" } }, { status: 400 });
  }
  const deck = await db.select().from(decks).where(eq(decks.slug, body.slug));
  if (deck.length === 0) {
    return NextResponse.json({ error: { code: "DECK_NOT_FOUND" } }, { status: 404 });
  }
  const deckId = deck[0].id;
  const existing = await db
    .select()
    .from(userDecks)
    .where(and(eq(userDecks.userId, user.id), eq(userDecks.deckId, deckId)));

  if (existing.length > 0) {
    const [updated] = await db
      .update(userDecks)
      .set({
        dailyNewLimit: body.dailyNewLimit ?? existing[0].dailyNewLimit,
        active: true,
      })
      .where(and(eq(userDecks.userId, user.id), eq(userDecks.deckId, deckId)))
      .returning();
    return NextResponse.json({ userDeck: updated });
  }
  const [inserted] = await db
    .insert(userDecks)
    .values({
      userId: user.id,
      deckId,
      dailyNewLimit: body.dailyNewLimit ?? deck[0].defaultDailyNewLimit,
    })
    .returning();
  return NextResponse.json({ userDeck: inserted });
}
