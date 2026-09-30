import { describe, expect, it } from "vitest";

import { parseExchange } from "../../scripts/lib/ecdict";
import { validatePackage } from "../../materials/schema";
import { ExplanationContentSchema } from "../../materials/schema/explanation";
import { WordEntrySchema } from "../../materials/schema/word";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

describe("parseExchange（ECDICT exchange 解析）", () => {
  it("解析 take 的完整词形变化", () => {
    expect(parseExchange("p:took/d:taken/i:taking/3:takes/s:takes")).toEqual({
      past: "took",
      pastParticiple: "taken",
      presentParticiple: "taking",
      thirdPerson: "takes",
      plural: "takes",
    });
  });

  it("解析复数形式", () => {
    expect(parseExchange("s:aristocracies")).toEqual({ plural: "aristocracies" });
  });

  it("空值返回 undefined", () => {
    expect(parseExchange(null)).toBeUndefined();
    expect(parseExchange("")).toBeUndefined();
  });
});

describe("WordEntrySchema", () => {
  it("合法词条通过", () => {
    expect(
      WordEntrySchema.safeParse({
        word: "aristocracy",
        translation: "n. 贵族",
        source: "ecdict-tag",
      }).success
    ).toBe(true);
  });

  it("数字开头/空释义被拒（专名由 validatePackage 规则 3 拦截，schema 层合法）", () => {
    expect(
      WordEntrySchema.safeParse({ word: "3d", translation: "x", source: "ecdict-tag" }).success
    ).toBe(false);
    expect(WordEntrySchema.safeParse({ word: "cat", translation: "", source: "ecdict-tag" }).success).toBe(
      false
    );
    expect(
      WordEntrySchema.safeParse({ word: "London", translation: "n. 伦敦", source: "ecdict-tag" }).success
    ).toBe(true);
  });
});

describe("ExplanationContentSchema", () => {
  const valid = {
    etymology: {
      parts: [{ part: "aristo", type: "root", meaning: "最佳" }],
      story: "来自希腊语 aristokratia。",
    },
    derivatives: [
      { word: "aristocrat", pos: "n.", meaning: "贵族" },
      { word: "democracy", pos: "n.", meaning: "民主" },
      { word: "autocracy", pos: "n.", meaning: "独裁" },
    ],
    examples: [
      { en: "a", zh: "甲" },
      { en: "b", zh: "乙" },
      { en: "c", zh: "丙" },
    ],
    synonyms: [{ group: ["a", "b"], diff: "规则" }],
    mnemonic: "猫爪抓老鼠记忆法",
  };

  it("完整内容通过", () => {
    expect(ExplanationContentSchema.safeParse(valid).success).toBe(true);
  });

  it("例句必须恰好 3 句；衍生词 3-8 个", () => {
    expect(ExplanationContentSchema.safeParse({ ...valid, examples: valid.examples.slice(0, 2) }).success).toBe(
      false
    );
    expect(
      ExplanationContentSchema.safeParse({ ...valid, derivatives: valid.derivatives.slice(0, 2) }).success
    ).toBe(false);
  });
});

describe("validatePackage（§2.6 校验规则）", () => {
  const baseWord = {
    word: "cat",
    translation: "n. 猫",
    source: "ecdict-tag" as const,
    inflections: { plural: "cats" },
  };
  const pluralWord = {
    word: "cats",
    translation: "n. 猫（复数）",
    source: "ecdict-tag" as const,
    inflections: { lemma: "cat" },
  };

  function writePackage(words: unknown[], relations: unknown[], explanations: unknown[]) {
    const dir = mkdtempSync(path.join(tmpdir(), "parrot-pkg-"));
    const sha = (data: string) =>
      "sha256:" + createHash("sha256").update(data).digest("hex");
    const files = {
      "words.json": JSON.stringify(words),
      "relations.json": JSON.stringify(relations),
      "explanations.json": JSON.stringify(explanations),
    };
    const manifest = {
      schemaVersion: 1,
      deck: { slug: "test", name: "T", exam: "X", defaultDailyNewLimit: 10, order: 1 },
      wordCount: words.length,
      generator: { ecdictVersion: "1", wordlistSources: [], generatedAt: "2026-01-01" },
      files: Object.fromEntries(Object.entries(files).map(([f, d]) => [f, sha(d)])),
    };
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    for (const [f, d] of Object.entries(files)) writeFileSync(path.join(dir, f), d);
    return dir;
  }

  it("合法包通过", () => {
    const expl = {
      word: "cat",
      model: "m",
      status: "ready",
      content: {
        etymology: { parts: [{ part: "cat", type: "root", meaning: "猫" }], story: "cat 源自古英语 catt，指代猫科动物的口语词，词源清晰无争议。" },
        derivatives: [
          { word: "catty", pos: "a.", meaning: "刻薄" },
          { word: "catlike", pos: "a.", meaning: "似猫" },
          { word: "cats", pos: "n.", meaning: "复数" },
        ],
        examples: [
          { en: "a cat", zh: "一只猫" },
          { en: "the cat", zh: "那只猫" },
          { en: "cats", zh: "猫们" },
        ],
        synonyms: [{ group: ["cat", "feline"], diff: "口语vs书面" }],
        mnemonic: "猫爪记忆法",
      },
    };
    const explPlural = { ...expl, word: "cats" };
    const dir = writePackage([baseWord, pluralWord], [{ word: "cat", related: "cats", relation: "inflection" }], [expl, explPlural]);
    expect(validatePackage(dir)).toEqual([]);
    rmSync(dir, { recursive: true });
  });

  it("规则 2：sha256 篡改被检出", () => {
    const dir = writePackage([baseWord, pluralWord], [], []);
    writeFileSync(path.join(dir, "words.json"), "[]"); // 篡改
    expect(validatePackage(dir).some((i) => i.rule === 2)).toBe(true);
    rmSync(dir, { recursive: true });
  });

  it("规则 3：重复词/专名被检出", () => {
    const dir = writePackage([baseWord, { ...baseWord, translation: "n. 猫2" }], [], []);
    expect(validatePackage(dir).some((i) => i.rule === 3)).toBe(true);
    rmSync(dir, { recursive: true });
  });

  it("规则 4：引用不存在的词被检出", () => {
    const dir = writePackage([baseWord, pluralWord], [{ word: "cat", related: "dog", relation: "inflection" }], []);
    expect(validatePackage(dir).some((i) => i.rule === 4)).toBe(true);
    rmSync(dir, { recursive: true });
  });

  it("规则 5：讲解覆盖率不足被检出", () => {
    const dir = writePackage([baseWord, pluralWord], [], []);
    expect(validatePackage(dir).some((i) => i.rule === 5)).toBe(true);
    rmSync(dir, { recursive: true });
  });
});
