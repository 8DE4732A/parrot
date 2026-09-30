/**
 * Step 1：词表固化（详设 §3.2 Step 1）
 *
 * 产物：scripts/.work/<deck>-wordlist.json  { word: source }
 * 来源优先级：外部权威词表(external-list) > ecdict-tag > llm-judged
 *
 * 策略（POC 实证）：
 * - ecdict tag 基础集：剔除 BNC 前 minBncRank(默认3000) 的基础词
 * - 外部权威词表（kajweb 雅思书）：编辑精选，全量并入（含中频词如 abandon）
 * - 漏词挖掘：无 tag、bnc ∈ (minBncRank, 15000]、非专名 → LLM 批量判类
 */
import "./lib/env";

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { openEcdict, queryByTag, queryUntaggedByBnc, queryWords, WORK_DIR } from "./lib/ecdict";

const DECK = "ielts";
const MIN_BNC_RANK = 3000; // ecdict-tag 词的频率下限（tag 圈定过宽）
const MIN_BNC_RANK_EXTERNAL = 500; // 外部词表词的频率下限（剔除 be/in/say 级功能词，保留 project/abandon 级考词）
const MAX_BNC_RANK = 15000;
const LLM_BATCH = 100;

interface KajwebEntry {
  headWord: string;
}

function loadKajwebWords(): Set<string> {
  const file = path.join(WORK_DIR, `kajweb-${DECK}.json`);
  if (!existsSync(file)) {
    console.log("  kajweb 词书不存在，跳过外部词表交叉");
    return new Set();
  }
  const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
  const set = new Set<string>();
  for (const line of lines) {
    const entry = JSON.parse(line) as KajwebEntry;
    const w = entry.headWord?.trim();
    if (w && /^[a-zA-Z][a-zA-Z'-]*$/.test(w)) set.add(w.toLowerCase());
  }
  return set;
}

function properNameFilter(words: string[]): string[] {
  return words.filter((w) => w === w.toLowerCase() || w.slice(1) !== w.slice(1).toLowerCase());
}

/** LLM 批量判类：哪些词属于雅思范围 */
async function llmJudge(words: string[]): Promise<Set<string>> {
  const baseURL = process.env.DEFAULT_LLM_BASE_URL ?? "http://127.0.0.1:9002/v1";
  const model = process.env.DEFAULT_LLM_MODEL ?? "deepseek-v4-1-flash";
  const provider = createOpenAICompatible({ name: "local-gateway", baseURL });
  const accepted = new Set<string>();

  for (let i = 0; i < words.length; i += LLM_BATCH) {
    const batch = words.slice(i, i + LLM_BATCH);
    const prompt = `以下是 ${batch.length} 个英语单词（附 BNC 词频排名）。判断每个词是否属于雅思（IELTS）备考应掌握的学术或生活场景词汇。
规则：日常极简单的初中级词汇（如 house, happy, eat）答 no；学科/社会/环境/工作/教育等雅思常见话题词或中高频通用词答 yes。
只输出 JSON 数组，元素为 {"word": "...", "yes": true/false}，不要输出其他内容。

单词列表：
${batch.map((w) => `- ${w}`).join("\n")}`;

    const { text } = await generateText({ model: provider(model), prompt });
    try {
      const jsonText = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
      const parsed = JSON.parse(jsonText) as Array<{ word: string; yes: boolean }>;
      for (const item of parsed) if (item.yes) accepted.add(item.word.toLowerCase());
    } catch {
      console.error(`  判类批次 ${i / LLM_BATCH} 解析失败，跳过该批`);
    }
    console.log(`  LLM 判类进度: ${Math.min(i + LLM_BATCH, words.length)}/${words.length}`);
  }
  return accepted;
}

async function main() {
  const db = openEcdict();
  const wordlist = new Map<string, string>();

  console.log("[1/4] ECDICT ielts tag 基础集");
  const tagged = queryByTag(db, DECK);
  const properTagged = properNameFilter(tagged.map((r) => r.word));
  let baseCount = 0;
  for (const row of tagged) {
    const w = row.word;
    if (!properTagged.includes(w)) continue;
    const bnc = row.bnc ?? 0;
    if (bnc > 0 && bnc <= MIN_BNC_RANK) continue; // 频率下限过滤
    wordlist.set(w.toLowerCase(), "ecdict-tag");
    baseCount++;
  }
  console.log(`  tag 词 ${tagged.length} → 过滤后 ${baseCount}`);

  console.log("[2/4] 外部权威词表交叉（kajweb 雅思书）");
  const kajweb = loadKajwebWords();
  const extRows = queryWords(db, [...kajweb]);
  let extCount = 0;
  for (const w of kajweb) {
    if (wordlist.has(w)) continue;
    const row = extRows.get(w);
    const bnc = row?.bnc ?? 0;
    if (bnc > 0 && bnc <= MIN_BNC_RANK_EXTERNAL) continue; // 功能词过滤
    wordlist.set(w, "external-list");
    extCount++;
  }
  console.log(`  kajweb ${kajweb.size} 词 → 新增 ${extCount}（剔除 ${kajweb.size - extCount}）`);

  console.log(`[3/4] 漏词挖掘（无 tag、bnc ${MIN_BNC_RANK + 1}~${MAX_BNC_RANK}）→ LLM 判类`);
  const candidates = properNameFilter(
    queryUntaggedByBnc(db, MIN_BNC_RANK + 1, MAX_BNC_RANK).map((r) => r.word)
  ).filter((w) => !wordlist.has(w.toLowerCase()));
  console.log(`  候选 ${candidates.length} 词`);
  const accepted = await llmJudge(candidates);
  let llmCount = 0;
  for (const w of accepted) {
    if (!wordlist.has(w)) {
      wordlist.set(w, "llm-judged");
      llmCount++;
    }
  }
  console.log(`  LLM 判类通过 ${accepted.size} → 新增 ${llmCount}`);

  console.log("[4/4] 固化产物");
  const out = Object.fromEntries([...wordlist.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const outFile = path.join(WORK_DIR, `${DECK}-wordlist.json`);
  writeFileSync(outFile, JSON.stringify(out, null, 0));
  console.log(`✅ ${outFile}: 共 ${wordlist.size} 词（tag=${baseCount} external=${extCount} llm=${llmCount}）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
