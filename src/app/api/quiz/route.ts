/**
 * 测验出题与判分（详设 §5.3 / §6.3）
 * GET  /api/quiz?count=10 — 从今日已学词抽题（choice/spell/cloze 混合），不含答案
 * POST /api/quiz — 判分写库；答错词 due 拉回今天 + review_logs(source=quiz_*)
 */
import { NextResponse } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSchema } from "@/lib/ensure-schema";
import { cardProgress, deckWords, quizRecords, reviewLogs, userDecks, wordExplanations, words } from "@/lib/schema";

/** 编辑距离 ≤1 判定（spell 容错提示用） */
function editDistanceWithin1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      if (++diff > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else {
        i++;
        j++;
      }
    }
  }
  diff += a.length - i + b.length - j;
  return diff <= 1;
}

interface QuizWord {
  wordId: number;
  word: string;
  phonetic: string | null;
  translation: string;
  inflections: { plural?: string; past?: string; pastParticiple?: string; presentParticiple?: string } | null;
  exampleEn: string | null;
}

async function getLearnedWords(userId: number): Promise<QuizWord[]> {
  const activeDecks = await db
    .select({ deckId: userDecks.deckId })
    .from(userDecks)
    .where(and(eq(userDecks.userId, userId), eq(userDecks.active, true)));
  if (activeDecks.length === 0) return [];

  const rows = await db
    .select({
      wordId: words.id,
      word: words.word,
      phonetic: words.phonetic,
      translation: words.translation,
      inflections: words.inflections,
    })
    .from(cardProgress)
    .innerJoin(words, eq(words.id, cardProgress.wordId))
    .where(and(eq(cardProgress.userId, userId), ne(cardProgress.state, 0)));

  const deckWordIds = new Set<number>();
  for (const { deckId } of activeDecks) {
    const dw = await db
      .select({ wordId: deckWords.wordId })
      .from(deckWords)
      .where(eq(deckWords.deckId, deckId));
    for (const r of dw) deckWordIds.add(r.wordId);
  }

  // 例句取自讲解缓存
  const ids = rows.map((r) => r.wordId).filter((id) => deckWordIds.has(id));
  const exampleMap = new Map<number, string>();
  if (ids.length > 0) {
    const exps = await db
      .select({ wordId: wordExplanations.wordId, content: wordExplanations.content })
      .from(wordExplanations)
      .where(and(eq(wordExplanations.status, "ready"), inArray(wordExplanations.wordId, ids)));
    for (const e of exps) {
      const content = e.content as { examples?: { en: string }[] } | null;
      exampleMap.set(e.wordId, content?.examples?.[0]?.en ?? "");
    }
  }

  return rows
    .filter((r) => deckWordIds.has(r.wordId))
    .map((r) => ({
      wordId: r.wordId,
      word: r.word,
      phonetic: r.phonetic,
      translation: r.translation,
      inflections: r.inflections as QuizWord["inflections"],
      exampleEn: exampleMap.get(r.wordId) ?? null,
    }));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** GET：出题 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  await ensureSchema();

  const count = Math.min(Number(new URL(req.url).searchParams.get("count") ?? 10), 30);
  const learned = await getLearnedWords(user.id);
  if (learned.length === 0) {
    return NextResponse.json({ questions: [] });
  }

  const picked = shuffle(learned).slice(0, count);
  const types = shuffle(["choice", "choice", "spell", "cloze"] as const);

  const questions = picked.map((w, i) => {
    const type = types[i % types.length];
    if (type === "choice") {
      // 干扰项取同词书其他词释义
      const distractors = shuffle(learned.filter((x) => x.wordId !== w.wordId))
        .slice(0, 3)
        .map((x) => x.translation.split("；")[0]);
      const options = shuffle([w.translation.split("；")[0], ...distractors]);
      return { id: `${w.wordId}-choice`, wordId: w.wordId, type, stem: { word: w.word, phonetic: w.phonetic }, options };
    }
    if (type === "spell") {
      // word 仅用于前端 TTS 播放（听音辨词），UI 不渲染
      return { id: `${w.wordId}-spell`, wordId: w.wordId, type, stem: { word: w.word, translation: w.translation.split("；")[0], phonetic: w.phonetic } };
    }
    // cloze：讲解例句挖词；无例句则降级为 choice
    const ex = w.exampleEn ?? "";
    const re = new RegExp(`\\b${w.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`, "i");
    if (!ex || !re.test(ex)) {
      const distractors = shuffle(learned.filter((x) => x.wordId !== w.wordId))
        .slice(0, 3)
        .map((x) => x.translation.split("；")[0]);
      return {
        id: `${w.wordId}-choice`,
        wordId: w.wordId,
        type: "choice",
        stem: { word: w.word, phonetic: w.phonetic },
        options: shuffle([w.translation.split("；")[0], ...distractors]),
      };
    }
    return {
      id: `${w.wordId}-cloze`,
      wordId: w.wordId,
      type: "cloze",
      stem: { sentence: ex.replace(re, "______"), translation: w.translation.split("；")[0] },
    };
  });

  return NextResponse.json({ questions });
}

/** POST：判分 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  await ensureSchema();

  const body = (await req.json()) as {
    answers: { id: string; wordId: number; type: string; answer: string; durationMs?: number }[];
  };
  const answers = body.answers ?? [];
  if (answers.length === 0) {
    return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
  }

  const wordIds = [...new Set(answers.map((a) => a.wordId))];
  const wordRows = await db.select().from(words).where(inArray(words.id, wordIds));
  const wordMap = new Map(wordRows.map((w) => [w.id, w]));

  const results: { id: string; correct: boolean; correctAnswer: string; hint?: string }[] = [];
  const now = new Date();

  // 全部判分写库原子提交（P0 同 review 路由）：quiz_records / card_progress /
  // review_logs 三写并发场景下中断会留下半套数据，append-only 日志失去意义
  await db.transaction(async (tx) => {
    for (const a of answers) {
      const w = wordMap.get(a.wordId);
      if (!w) continue;
      const normalize = (s: string) => s.trim().toLowerCase();
      let correct = false;
      let correctAnswer = "";
      let hint: string | undefined;

      if (a.type === "choice") {
        correctAnswer = w.translation.split("；")[0];
        correct = normalize(a.answer) === normalize(correctAnswer);
      } else {
        // spell / cloze：忽略大小写；inflections 命中视为正确；编辑距离 1 判错但提示
        const forms = new Set(
          [
            w.word,
            ...(Object.values((w.inflections as Record<string, string> | null) ?? {}) as string[]),
          ].map(normalize)
        );
        const given = normalize(a.answer);
        correct = forms.has(given);
        correctAnswer = w.word;
        hint =
          !correct && [...forms].some((f) => editDistanceWithin1(f, given))
            ? "差一个字母"
            : undefined;
      }

      results.push({ id: a.id, correct, correctAnswer, hint });

      await tx.insert(quizRecords).values({
        userId: user.id,
        wordId: a.wordId,
        type: a.type,
        question: { id: a.id, answer: a.answer },
        answer: a.answer,
        correct,
        durationMs: a.durationMs,
      });

      // 答错：due 拉回今天 + review_logs
      if (!correct) {
        const cp = await tx
          .select()
          .from(cardProgress)
          .where(and(eq(cardProgress.userId, user.id), eq(cardProgress.wordId, a.wordId)));
        if (cp[0]) {
          await tx
            .update(cardProgress)
            .set({ due: now, state: 3 }) // Relearning
            .where(and(eq(cardProgress.userId, user.id), eq(cardProgress.wordId, a.wordId)));
        }
        await tx.insert(reviewLogs).values({
          userId: user.id,
          wordId: a.wordId,
          grade: 1, // Again
          state: cp[0]?.state ?? 0,
          reviewedAt: now,
          source: `quiz_${a.type}`,
        });
      }
    }
  });

  return NextResponse.json({
    results,
    correctCount: results.filter((r) => r.correct).length,
  });
}
