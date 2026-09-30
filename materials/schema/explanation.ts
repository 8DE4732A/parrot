import { z } from "zod";

/** AI 深度讲解内容 schema——素材包、本地流水线、客户端生成、服务端代理四处共用 */

export const ExplanationContentSchema = z.object({
  etymology: z.object({
    parts: z
      .array(
        z.object({
          part: z.string(),
          type: z.enum(["prefix", "root", "suffix"]),
          meaning: z.string(),
        })
      )
      .min(1),
    story: z.string().min(10),
  }),
  derivatives: z
    .array(
      z.object({
        word: z.string(),
        pos: z.string(),
        meaning: z.string(),
      })
    )
    .min(3)
    .max(8),
  examples: z
    .array(z.object({ en: z.string(), zh: z.string() }))
    .length(3),
  synonyms: z
    .array(
      z.object({
        group: z.array(z.string()).min(2).max(4),
        diff: z.string(),
      })
    )
    .min(1)
    .max(4),
  mnemonic: z.string().min(5),
});

export const ExplanationEntrySchema = z.object({
  word: z.string(),
  model: z.string(),
  status: z.literal("ready"), // 素材包只收 ready；failed 不打包
  content: ExplanationContentSchema,
  tokens: z
    .object({ prompt: z.number(), completion: z.number() })
    .optional(),
});

export type ExplanationContent = z.infer<typeof ExplanationContentSchema>;
export type ExplanationEntry = z.infer<typeof ExplanationEntrySchema>;
