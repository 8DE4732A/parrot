/**
 * Step 4：AI 讲解批量生成（详设 §3.2 Step 4 / §7）
 * - 断点续跑：已有 status=ready 的词跳过
 * - 并发 + 429 指数退避 + Zod 校验失败带错误重试
 * - 增量落盘：每完成一个词立即写回
 * 产物：materials/ielts/explanations.json
 *
 * 说明：不使用 SDK 的 responseFormat/structuredOutputs（本地网关不支持），
 * 改为 prompt 约定 JSON 输出 + 自行提取 + Zod 校验，对任何 OpenAI 兼容网关通用。
 *
 * 用法：npx tsx scripts/generate-explanations.ts [--limit N]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import {
  ExplanationContentSchema,
  type ExplanationContent,
  type ExplanationEntry,
} from "../materials/schema/explanation";
import type { WordEntry } from "../materials/schema/word";

const DECK = "ielts";
const MATERIALS = path.resolve(__dirname, "..", "materials", DECK);
const CONCURRENCY = 5;
const MAX_RETRY = 3;

const argLimit = (() => {
  const i = process.argv.indexOf("--limit");
  return i > 0 ? Number(process.argv[i + 1]) : undefined;
})();

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

function buildPrompt(w: WordEntry): string {
  const freq =
    w.frequency?.bnc != null
      ? `BNC 词频排名 ${w.frequency.bnc}`
      : w.frequency?.frq != null
        ? `COCA 词频排名 ${w.frequency.frq}`
        : "词频未知";
  return `为以下单词生成深度讲解。

单词：${w.word}
音标：${w.phonetic ?? "无"}
词性：${w.pos ?? "无"}
中文释义：${w.translation}
英文释义：${w.definition ?? "无"}
词频：${freq}`;
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("输出中未找到 JSON 对象");
  return JSON.parse(text.slice(start, end + 1));
}

async function main() {
  const words: WordEntry[] = JSON.parse(
    readFileSync(path.join(MATERIALS, "words.json"), "utf-8")
  );
  const outFile = path.join(MATERIALS, "explanations.json");
  const entries = new Map<string, ExplanationEntry>();
  if (existsSync(outFile)) {
    for (const e of JSON.parse(readFileSync(outFile, "utf-8")) as ExplanationEntry[])
      entries.set(e.word.toLowerCase(), e);
  }

  const baseURL = process.env.DEFAULT_LLM_BASE_URL ?? "http://127.0.0.1:9002/v1";
  const modelId = process.env.DEFAULT_LLM_MODEL ?? "deepseek-v4-1-flash";
  const provider = createOpenAICompatible({ name: "local-gateway", baseURL });
  const model = provider(modelId);

  const pending = words.filter((w) => !entries.has(w.word.toLowerCase()));
  const todo = argLimit ? pending.slice(0, argLimit) : pending;
  console.log(
    `总 ${words.length} 词 | 已 ready ${entries.size} | 待生成 ${pending.length}${argLimit ? ` | 本次限 ${todo.length}` : ""}`
  );

  let done = 0;
  let failed = 0;
  const startedAt = Date.now();
  const failedEntries = new Map<string, { word: string; error: string; retryCount: number }>();

  async function generateOne(w: WordEntry): Promise<void> {
    const key = w.word.toLowerCase();
    let lastError = "";
    let feedback = "";

    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        const { text, usage } = await generateText({
          model,
          system: PROMPT_SYSTEM,
          prompt: buildPrompt(w) + (feedback ? `\n\n上次输出未通过校验：${feedback}\n请修正后重新输出完整 JSON。` : ""),
          maxRetries: 2, // SDK 层网络/429 重试
        });
        const raw = extractJson(text);
        const parsed = ExplanationContentSchema.safeParse(raw);
        if (!parsed.success) {
          feedback = parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          throw new Error(`schema 校验失败: ${feedback}`);
        }
        const content: ExplanationContent = parsed.data;
        entries.set(key, {
          word: w.word,
          model: modelId,
          status: "ready",
          content,
          tokens: usage
            ? { prompt: usage.inputTokens ?? 0, completion: usage.outputTokens ?? 0 }
            : undefined,
        });
        done++;
        if (done % 10 === 0 || done === todo.length) {
          const rate = done / ((Date.now() - startedAt) / 1000);
          console.log(
            `进度 ${done}/${todo.length}（失败 ${failed}）| ${rate.toFixed(2)} 词/s | 剩余约 ${Math.round((todo.length - done) / rate / 60)} 分钟`
          );
          writeFileSync(outFile, JSON.stringify([...entries.values()]));
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (lastError.includes("429") || lastError.toLowerCase().includes("rate limit")) {
          await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); // 指数退避
        }
      }
    }
    const prev = failedEntries.get(key);
    failedEntries.set(key, {
      word: w.word,
      error: lastError,
      retryCount: (prev?.retryCount ?? 0) + 1,
    });
    failed++;
  }

  const queue = [...todo];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const w = queue.shift();
        if (!w) break;
        await generateOne(w);
      }
    })
  );

  writeFileSync(outFile, JSON.stringify([...entries.values()]));
  if (failedEntries.size > 0) {
    writeFileSync(
      path.join(MATERIALS, ".explanations-failed.json"),
      JSON.stringify([...failedEntries.values()], null, 2)
    );
  }
  console.log(
    `✅ ${outFile}: ready ${entries.size} / ${words.length}（本轮失败 ${failed}）`
  );
  if (entries.size < words.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
