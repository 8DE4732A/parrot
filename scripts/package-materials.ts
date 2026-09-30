/**
 * Step 5：打包校验（详设 §3.2 Step 5）
 * 汇集四文件 → 计算 sha256 写入 manifest → 全量校验。
 * 前置条件：explanations.json 覆盖率 100%（规则 5 门槛）。
 */
import { existsSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

import { sha256File, validatePackage } from "../materials/schema";
import type { Manifest } from "../materials/schema/manifest";

const DECK = "ielts";
const MATERIALS = path.resolve(__dirname, "..", "materials", DECK);

const DECK_META = {
  slug: DECK,
  name: "雅思核心词汇",
  description: "ECDICT ielts 词表 + kajweb 雅思书交叉 + LLM 判类补漏，经频率分层过滤",
  exam: "IELTS",
  defaultDailyNewLimit: 10,
  order: 1,
};

function main() {
  const words: unknown[] = JSON.parse(readFileSync(path.join(MATERIALS, "words.json"), "utf-8"));
  const explanationsFile = path.join(MATERIALS, "explanations.json");
  if (!existsSync(explanationsFile)) {
    console.error("❌ explanations.json 不存在——先跑 generate-explanations.ts");
    process.exit(1);
  }

  const manifest: Manifest = {
    schemaVersion: 1,
    deck: DECK_META,
    wordCount: words.length,
    generator: {
      ecdictVersion: "1.0.28",
      wordlistSources: ["ecdict:tag:ielts", "kajweb-dict:IELTS_2", "llm:judged"],
      llmModel: process.env.DEFAULT_LLM_MODEL ?? "deepseek-v4-1-flash",
      generatedAt: new Date().toISOString(),
    },
    config: {
      minBncRank: 3000,
      explanationCoverage: 1,
    },
    files: {
      "words.json": sha256File(path.join(MATERIALS, "words.json")),
      "relations.json": sha256File(path.join(MATERIALS, "relations.json")),
      "explanations.json": sha256File(explanationsFile),
    },
  };
  writeFileSync(path.join(MATERIALS, "manifest.json"), JSON.stringify(manifest, null, 2));

  // 打包后清理 failed 记录（未 ready 的词会被规则 5 拦下）
  const failedFile = path.join(MATERIALS, ".explanations-failed.json");
  if (existsSync(failedFile)) rmSync(failedFile);

  const issues = validatePackage(MATERIALS);
  if (issues.length > 0) {
    console.error(`❌ ${DECK}: ${issues.length} 个问题`);
    for (const i of issues.slice(0, 20)) console.error(`   [规则${i.rule}] ${i.message}`);
    process.exit(1);
  }
  const size = ["words.json", "relations.json", "explanations.json"]
    .map((f) => `${f}=${(statSync(path.join(MATERIALS, f)).size / 1024 / 1024).toFixed(1)}MB`)
    .join(" ");
  console.log(`✅ 素材包 ${DECK} 打包并校验通过（${words.length} 词）| ${size}`);
}

main();
