/**
 * AI 讲解生成（服务端兜底代理，详设 §7.6 步骤 4）
 * 用本地流水线同一份 prompt + schema；key 来源：
 * 1. 用户 user_settings 的 llm 配置（BYOK，AES 解密后仅内存使用）
 * 2. 兜底 DEFAULT_LLM_* env
 * 限流 10 req/min/IP（内存）。
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { ExplanationContentSchema } from "@materials/schema/explanation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSchema } from "@/lib/ensure-schema";
import { userSettings, wordExplanations, words } from "@/lib/schema";

const PROMPT_SYSTEM = `你是资深英语词汇老师，为备考 IELTS（雅思）的学生生成单词深度讲解。
要求：
1. 词根词缀拆解必须词源学正确；不确定时 parts 给出最可信拆法并在 story 中明确"词源存在争议/不详"，禁止编造词源。
2. 例句 3 句：使用与给定词频匹配的地道表达，分别覆盖雅思听力场景对话、阅读学术文本、口语表达三类语境；例句中必须自然包含目标词（允许合理词形变化）。
3. 近义辨析：聚焦中国学习者最易混淆的近义词，diff 必须给出可操作的区分规则（如"接动名词 vs 接不定式"），禁止空泛比较。
4. 记忆法优先基于已拆解的词根讲故事；无合适词根时才用谐音/联想。
5. 衍生词 3-8 个，按考试常用度排序。
6. 只输出一个 JSON 对象，不要输出任何其他文字或 markdown 代码块标记。结构：
{"etymology":{"parts":[{"part":"...","type":"prefix|root|suffix","meaning":"..."}],"story":"..."},"derivatives":[{"word":"...","pos":"...","meaning":"..."}],"examples":[{"en":"...","zh":"..."},{"en":"...","zh":"..."},{"en":"...","zh":"..."}],"synonyms":[{"group":["...","..."],"diff":"..."}],"mnemonic":"..."}
中文释义/辨析用简体中文，例句用英文。`;

// 内存限流：10 req/min/IP
const rateMap = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 10;
}

interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

async function resolveLlmConfig(userId: number): Promise<LlmConfig> {
  const settings = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  const llm = settings.find((s) => s.key === "llm")?.value as
    | { provider: string; baseUrl: string; model: string; apiKeyEnc?: string }
    | undefined;
  if (llm?.baseUrl && llm?.model) {
    let apiKey = llm.apiKeyEnc ?? "";
    if (apiKey) {
      // BYOK key 解密（AES-256-GCM，密钥派生自 AUTH_SECRET）——M6 接入加密存储后启用
      // 一期 key 由用户在本地 settings 明文存 PGLite（个人设备），生产 Neon 时强制加密
    }
    return { baseUrl: llm.baseUrl, model: llm.model, apiKey };
  }
  return {
    baseUrl: process.env.DEFAULT_LLM_BASE_URL ?? "http://127.0.0.1:9002/v1",
    model: process.env.DEFAULT_LLM_MODEL ?? "deepseek-v4-1-flash",
    apiKey: process.env.DEFAULT_LLM_API_KEY ?? "",
  };
}

export async function POST(_req: Request, ctx: { params: Promise<{ wordId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  await ensureSchema();

  const ip = _req.headers.get("x-forwarded-for") ?? "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: { code: "RATE_LIMITED" } }, { status: 429 });
  }

  const { wordId: wordIdStr } = await ctx.params;
  const wordId = Number(wordIdStr);
  if (!Number.isInteger(wordId)) {
    return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
  }

  // 已 ready 直接返回（幂等）
  const existing = await db
    .select()
    .from(wordExplanations)
    .where(eq(wordExplanations.wordId, wordId));
  if (existing[0]?.status === "ready") {
    return NextResponse.json({ explanation: existing[0].content });
  }

  const wordRows = await db.select().from(words).where(eq(words.id, wordId));
  const word = wordRows[0];
  if (!word) return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });

  const cfg = await resolveLlmConfig(user.id);
  const provider = createOpenAICompatible({
    name: "parrot-llm",
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey || undefined,
  });

  const prompt = `为以下单词生成深度讲解。

单词：${word.word}
音标：${word.phonetic ?? "无"}
词性：${word.pos ?? "无"}
中文释义：${word.translation}
英文释义：${word.definition ?? "无"}
词频：${word.bnc ? `BNC 排名 ${word.bnc}` : "词频未知"}`;

  try {
    const { text, usage } = await generateText({
      model: provider(cfg.model),
      system: PROMPT_SYSTEM,
      prompt,
      maxRetries: 2,
    });
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = ExplanationContentSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "SCHEMA_MISMATCH", message: parsed.error.issues[0]?.message } },
        { status: 502 }
      );
    }

    const now = new Date();
    const values = {
      wordId,
      model: cfg.model,
      status: "ready",
      content: parsed.data,
      promptTokens: usage?.inputTokens ?? null,
      completionTokens: usage?.outputTokens ?? null,
      origin: "server" as const,
      generatedBy: user.id,
      generatedAt: now,
    };
    await db
      .insert(wordExplanations)
      .values(values)
      .onConflictDoUpdate({ target: wordExplanations.wordId, set: values });
    return NextResponse.json({ explanation: parsed.data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .insert(wordExplanations)
      .values({ wordId, model: cfg.model, status: "failed", origin: "server", generatedBy: user.id, lastError: message })
      .onConflictDoUpdate({
        target: wordExplanations.wordId,
        set: { status: "failed", lastError: message, origin: "server", generatedBy: user.id },
      });
    return NextResponse.json({ error: { code: "GENERATION_FAILED", message } }, { status: 502 });
  }
}
