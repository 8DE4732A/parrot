import { z } from "zod";

/**
 * 词族关联（素材包 v1 只含确定性 inflection 关联）。
 * derivative 关联不进素材包：由 AI 讲解生成后回链 DB（详设 §7.4）。
 */
export const RelationEntrySchema = z.object({
  word: z.string(),
  related: z.string(),
  relation: z.enum(["inflection"]),
});

export type RelationEntry = z.infer<typeof RelationEntrySchema>;
