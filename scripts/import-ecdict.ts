/**
 * Step 2：清洗与产出 words.json（详设 §3.2 Step 2）
 * - 按 wordlist 从 ECDICT 抽取 → 字段清洗 → exchange 解析 → 音标补齐 → 按 frq 排序
 * 产物：materials/ielts/words.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { openEcdict, parseExchange, queryWords, WORK_DIR } from "./lib/ecdict";
import type { WordEntry } from "../materials/schema/word";

const DECK = "ielts";

/** 规范化 ECDICT 音标：去掉开头 "." 分隔符，统一斜杠包裹由展示层处理 */
function cleanPhonetic(p: string | null): string | undefined {
  if (!p) return undefined;
  const cleaned = p.replace(/^[.\s]+/, "").trim();
  return cleaned || undefined;
}

/** 清洗中文释义：去掉学科标注块（[医]...），压平换行 */
function cleanTranslation(t: string | null): string {
  if (!t) return "";
  return t
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^\[[^\]]+\]/.test(line)) // 去掉 "[法] ..." 等学科行
    .join("；");
}

/** kajweb 词书的英美双音标（word → {uk, us}），无则跳过 */
function loadKajwebPron(): Record<string, { uk?: string; us?: string }> {
  const f = path.join(WORK_DIR, "kajweb-pron.json");
  try {
    return JSON.parse(readFileSync(f, "utf-8"));
  } catch {
    return {};
  }
}

function main() {
  const db = openEcdict();
  const kajwebPron = loadKajwebPron();
  const wordlist: Record<string, string> = JSON.parse(
    readFileSync(path.join(WORK_DIR, `${DECK}-wordlist.json`), "utf-8")
  );
  const words = Object.keys(wordlist);
  console.log(`词表 ${words.length} 词，从 ECDICT 抽取…`);

  const rows = queryWords(db, words);
  const entries: WordEntry[] = [];
  let noPhonetic = 0;
  let dropped = 0;

  for (const w of words) {
    const row = rows.get(w.toLowerCase());
    const source = wordlist[w] as WordEntry["source"];
    if (!row || !row.translation) {
      // 词表中的词 ECDICT 无词条或无释义（外部词表词理论上都有）
      dropped++;
      continue;
    }
    // 短语（含空格）与全大写缩写词不在背单词范围——用 ECDICT 规范大小写判断
    // （wordlist key 可能是小写，w === w.toUpperCase() 判断不到 PETS/CD-ROM 这类词）
    if (row.word.includes(" ") || (row.word === row.word.toUpperCase() && row.word.length > 1)) {
      dropped++;
      continue;
    }
    const translation = cleanTranslation(row.translation);
    if (!translation) {
      dropped++;
      continue;
    }
    let phonetic = cleanPhonetic(row.phonetic);
    if (!phonetic) {
      // 音标补齐：经 lemma 还原到原形词取音标（详设 Step 2）
      const inflections = parseExchange(row.exchange);
      const lemma = inflections?.lemma;
      if (lemma) {
        const lemmaRow = rows.get(lemma.toLowerCase());
        if (!lemmaRow) {
          const [lemmaHit] = [...queryWords(db, [lemma]).values()];
          phonetic = cleanPhonetic(lemmaHit?.phonetic ?? null);
        } else {
          phonetic = cleanPhonetic(lemmaRow.phonetic);
        }
      }
    }
    if (!phonetic) noPhonetic++;
    const bnc = row.bnc && row.bnc > 0 ? row.bnc : undefined;
    const frq = row.frq && row.frq > 0 ? row.frq : undefined;
    const kp = kajwebPron[row.word.toLowerCase()];
    entries.push({
      word: row.word,
      phonetic: phonetic ?? kp?.uk,
      phoneticUs: kp?.us,
      translation,
      definition: row.definition?.trim() || undefined,
      pos: row.pos || undefined,
      frequency: bnc || frq ? { bnc, frq } : undefined,
      inflections: parseExchange(row.exchange),
      source,
    });
  }

  // 排序：frq 升序（无 frq 的排后，按字母），= 新词先学高频
  entries.sort((a, b) => {
    const fa = a.frequency?.frq ?? Number.MAX_SAFE_INTEGER;
    const fb = b.frequency?.frq ?? Number.MAX_SAFE_INTEGER;
    return fa !== fb ? fa - fb : a.word.localeCompare(b.word);
  });

  const outDir = path.resolve(__dirname, "..", "materials", DECK);
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "words.json");
  writeFileSync(out, JSON.stringify(entries));
  console.log(
    `✅ ${out}: ${entries.length} 词（丢弃 ${dropped}，缺音标 ${noPhonetic}）`
  );
}

main();
