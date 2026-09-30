/**
 * Step 3：词形关联（详设 §3.2 Step 3）
 * 遍历 inflections，变化形式也在 words.json 中则建双向 inflection 关联。
 * 明确不做字符串前缀/相似度挖掘（POC 实证噪音大）。
 * 产物：materials/ielts/relations.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { RelationEntry } from "../materials/schema/relation";
import type { WordEntry } from "../materials/schema/word";

const DECK = "ielts";
const MATERIALS = path.resolve(__dirname, "..", "materials", DECK);

function main() {
  const words: WordEntry[] = JSON.parse(readFileSync(path.join(MATERIALS, "words.json"), "utf-8"));
  const wordSet = new Set(words.map((w) => w.word.toLowerCase()));

  const seen = new Set<string>();
  const relations: RelationEntry[] = [];

  for (const w of words) {
    const inf = w.inflections;
    if (!inf) continue;
    const base = w.word.toLowerCase();
    for (const form of Object.values(inf)) {
      const f = form.toLowerCase();
      if (!wordSet.has(f) || f === base) continue;
      // 双向各存一行；关系在两条方向上同为 inflection
      for (const [from, to] of [
        [base, f],
        [f, base],
      ] as const) {
        const key = `${from}>${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        relations.push({ word: from, related: to, relation: "inflection" });
      }
    }
  }

  const out = path.join(MATERIALS, "relations.json");
  writeFileSync(out, JSON.stringify(relations));
  console.log(`✅ ${out}: ${relations.length} 条 inflection 关联（涉及 ${seen.size} 个有向对）`);
}

main();
