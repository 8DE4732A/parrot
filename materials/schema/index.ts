/**
 * 素材包全量校验（详设 §2.6 六条规则，CI 强制）
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ExplanationEntrySchema } from "./explanation";
import { ManifestSchema, type Manifest } from "./manifest";
import { RelationEntrySchema } from "./relation";
import { WordEntrySchema } from "./word";

export * from "./explanation";
export * from "./manifest";
export * from "./relation";
export * from "./word";

export interface PackageData {
  manifest: Manifest;
  words: unknown[];
  relations: unknown[];
  explanations: unknown[];
}

export function readPackage(dir: string): PackageData {
  const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf-8"));
  return {
    manifest: ManifestSchema.parse(read("manifest.json")),
    words: read("words.json"),
    relations: read("relations.json"),
    explanations: read("explanations.json"),
  };
}

export function sha256File(filePath: string): string {
  return "sha256:" + createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export interface ValidateIssue {
  rule: number;
  message: string;
}

/** 全量校验一个素材包目录，返回全部问题（空数组 = 通过） */
export function validatePackage(dir: string): ValidateIssue[] {
  const issues: ValidateIssue[] = [];
  const add = (rule: number, message: string) => issues.push({ rule, message });

  // ---- 规则 1 & 6：schema 解析 + 版本 ----
  let pkg: PackageData;
  try {
    pkg = readPackage(dir);
  } catch (err) {
    add(1, `schema 解析失败: ${err instanceof Error ? err.message : String(err)}`);
    return issues;
  }
  const { manifest, words, relations, explanations } = pkg;

  // ---- 规则 2：sha256 完整性 ----
  for (const [file, expected] of Object.entries(manifest.files)) {
    const actual = sha256File(path.join(dir, file));
    if (actual !== expected) add(2, `${file} sha256 不一致: manifest=${expected} actual=${actual}`);
  }

  // ---- 规则 3：words 唯一/释义非空/专名短语 ----
  const wordSet = new Set<string>();
  const allowlist = new Set(manifest.config?.phraseAllowlist ?? []);
  words.forEach((raw, i) => {
    const r = WordEntrySchema.safeParse(raw);
    if (!r.success) {
      add(3, `words[${i}] 校验失败: ${r.error.issues[0]?.message}`);
      return;
    }
    const w = r.data.word.toLowerCase();
    if (wordSet.has(w)) add(3, `words[${i}] 重复词条: ${w}`);
    wordSet.add(w);
    const isProper = /^[A-Z]/.test(r.data.word) && r.data.word.slice(1) !== r.data.word.slice(1).toLowerCase();
    if (isProper) add(3, `words[${i}] 疑似专名: ${r.data.word}`);
    if (r.data.word.includes(" ") && !allowlist.has(r.data.word))
      add(3, `words[${i}] 短语未在豁免清单: ${r.data.word}`);
  });

  // ---- 规则 4：引用完整性 ----
  const missing = (w: string, i: number, file: string) =>
    add(4, `${file}[${i}] 引用不存在词条: ${w}`);
  relations.forEach((raw, i) => {
    const r = RelationEntrySchema.safeParse(raw);
    if (!r.success) return add(4, `relations[${i}] 校验失败`);
    if (!wordSet.has(r.data.word.toLowerCase())) missing(r.data.word, i, "relations");
    if (!wordSet.has(r.data.related.toLowerCase())) missing(r.data.related, i, "relations");
    if (r.data.word.toLowerCase() === r.data.related.toLowerCase())
      add(4, `relations[${i}] 自关联: ${r.data.word}`);
  });
  explanations.forEach((raw, i) => {
    const r = ExplanationEntrySchema.safeParse(raw);
    if (!r.success) return add(4, `explanations[${i}] 校验失败: ${r.error.issues[0]?.message}`);
    if (!wordSet.has(r.data.word.toLowerCase())) missing(r.data.word, i, "explanations");
  });

  // ---- 规则 5：讲解覆盖率 ----
  const coverage = manifest.config?.explanationCoverage ?? 1;
  const readyWords = new Set(
    explanations
      .map((raw) => ExplanationEntrySchema.safeParse(raw))
      .filter((r) => r.success)
      .map((r) => r.data.word.toLowerCase())
  );
  const actual = words.length === 0 ? 0 : readyWords.size / words.length;
  if (actual < coverage) add(5, `讲解覆盖率 ${(actual * 100).toFixed(1)}% < 门槛 ${coverage * 100}%`);

  // ---- 附加：wordCount 一致性 ----
  if (manifest.wordCount !== words.length)
    add(1, `manifest.wordCount=${manifest.wordCount} 与 words.json 实际 ${words.length} 不符`);

  return issues;
}
