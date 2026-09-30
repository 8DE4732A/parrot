import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import type { Grade } from "ts-fsrs";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSchema } from "@/lib/ensure-schema";
import { reviewCard, rowFromCard } from "@/lib/fsrs";
import { cardProgress, reviewLogs, userSettings } from "@/lib/schema";

/** POST /api/review — FSRS 评分（详设 §5.3） */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  await ensureSchema();

  const body = (await req.json()) as {
    wordId?: number;
    grade?: number;
    source?: string;
  };
  const { wordId, grade } = body;
  if (typeof wordId !== "number" || ![1, 2, 3, 4].includes(grade ?? 0)) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "wordId 与 grade(1-4) 必填" } },
      { status: 400 }
    );
  }

  // FSRS 参数（user_settings，默认 0.9）
  let requestRetention = 0.9;
  const settings = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, user.id));
  const fsrsSetting = settings.find((s) => s.key === "fsrs");
  if (fsrsSetting) {
    const v = (fsrsSetting.value as { requestRetention?: number }).requestRetention;
    if (typeof v === "number") requestRetention = v;
  }

  const now = new Date();
  const rows = await db
    .select()
    .from(cardProgress)
    .where(eq(cardProgress.userId, user.id))
    .then((all) => all.filter((r) => r.wordId === wordId));
  const existing = rows[0] ?? null;

  const { card, log } = reviewCard(
    existing
      ? {
          state: existing.state,
          due: existing.due,
          stability: existing.stability,
          difficulty: existing.difficulty,
          elapsedDays: existing.elapsedDays,
          scheduledDays: existing.scheduledDays,
          reps: existing.reps,
          lapses: existing.lapses,
          lastReview: existing.lastReview,
        }
      : null,
    grade as Grade,
    now,
    requestRetention
  );

  const row = rowFromCard(card);
  if (existing) {
    await db
      .update(cardProgress)
      .set(row)
      .where(and(eq(cardProgress.userId, user.id), eq(cardProgress.wordId, wordId)));
  } else {
    await db.insert(cardProgress).values({ userId: user.id, wordId, ...row });
  }
  await db.insert(reviewLogs).values({
    userId: user.id,
    wordId,
    grade: grade as Grade,
    state: log.state,
    due: log.due,
    stability: log.stability,
    difficulty: log.difficulty,
    elapsedDays: log.elapsed_days,
    scheduledDays: log.scheduled_days,
    source: body.source ?? "card",
  });

  return NextResponse.json({
    card: {
      state: row.state,
      due: row.due.toISOString(),
      stability: row.stability,
      difficulty: row.difficulty,
      reps: row.reps,
      lapses: row.lapses,
    },
  });
}
