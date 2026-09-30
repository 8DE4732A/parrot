import { z } from "zod";

export const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  deck: z.object({
    slug: z
      .string()
      .regex(/^[a-z0-9-]{2,32}$/),
    name: z.string().min(1),
    description: z.string().optional(),
    exam: z.string().min(1),
    defaultDailyNewLimit: z.number().int().min(1).max(100).default(10),
    order: z.number().int().default(1),
  }),
  wordCount: z.number().int().positive(),
  generator: z.object({
    ecdictVersion: z.string(),
    wordlistSources: z.array(z.string()),
    llmModel: z.string().optional(),
    generatedAt: z.string(),
  }),
  config: z
    .object({
      minBncRank: z // 频率下限过滤阈值（详设 §3.2 Step 1）
        .number()
        .int()
        .optional(),
      explanationCoverage: z // 讲解覆盖率门槛，默认 1
        .number()
        .min(0)
        .max(1)
        .optional(),
      phraseAllowlist: z.array(z.string()).optional(), // 允许保留的短语豁免清单
    })
    .optional(),
  files: z.record(z.string(), z.string()), // filename -> sha256:...
});

export type Manifest = z.infer<typeof ManifestSchema>;
