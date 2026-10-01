import { z } from "zod";

/** 词形变化（ECDICT exchange 字段解析产物） */
export const InflectionsSchema = z.object({
  plural: z.string().optional(), // s:
  past: z.string().optional(), // p:
  pastParticiple: z.string().optional(), // d:
  presentParticiple: z.string().optional(), // i:
  thirdPerson: z.string().optional(), // 3:
  comparative: z.string().optional(), // r:
  superlative: z.string().optional(), // t:
  lemma: z.string().optional(), // 0:/1: 还原为原形
});

export const WordEntrySchema = z.object({
  word: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z][a-zA-Z'-]*$/, "必须以字母开头，仅含字母/连字符/撇号"),
  phonetic: z.string().optional(),
  phoneticUs: z.string().optional(), // 美式音标（kajweb 词书来源）
  translation: z.string().min(1, "中文释义必填"),
  definition: z.string().optional(),
  pos: z.string().optional(),
  frequency: z
    .object({
      bnc: z.number().int().optional(),
      frq: z.number().int().optional(),
    })
    .optional(),
  inflections: InflectionsSchema.optional(),
  source: z.enum(["ecdict-tag", "external-list", "llm-judged"]),
});

export type WordEntry = z.infer<typeof WordEntrySchema>;
export type Inflections = z.infer<typeof InflectionsSchema>;
