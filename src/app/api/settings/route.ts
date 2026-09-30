import { NextResponse } from "next/server";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSchema } from "@/lib/ensure-schema";
import { userSettings } from "@/lib/schema";

/** AES-256-GCM：key 派生自 AUTH_SECRET（详设 §9）。key 明文只回本人。 */
function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET ?? "dev-insecure-secret";
  return createHash("sha256").update(secret).digest();
}
function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}
function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(":");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf-8");
}

const mask = (key: string) => (key.length <= 8 ? "****" : `${key.slice(0, 5)}...${key.slice(-4)}`);

/** GET /api/settings — llm（掩码）/fsrs 配置 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  await ensureSchema();

  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, user.id));
  const llmRaw = rows.find((r) => r.key === "llm")?.value as
    | { provider: string; baseUrl: string; model: string; apiKeyEnc: string }
    | undefined;
  const fsrs = rows.find((r) => r.key === "fsrs")?.value as { requestRetention?: number } | undefined;

  return NextResponse.json({
    llm: llmRaw
      ? {
          provider: llmRaw.provider,
          baseUrl: llmRaw.baseUrl,
          model: llmRaw.model,
          apiKeyMasked: llmRaw.apiKeyEnc ? mask(decrypt(llmRaw.apiKeyEnc)) : null,
        }
      : null,
    fsrs: fsrs ?? { requestRetention: 0.9 },
  });
}

/** PUT /api/settings — 保存配置（apiKey 加密入库，服务端不落明文） */
export async function PUT(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  await ensureSchema();

  const body = (await req.json()) as {
    llm?: { provider?: string; baseUrl?: string; model?: string; apiKey?: string };
    fsrs?: { requestRetention?: number };
  };

  if (body.llm) {
    const existing = await db
      .select()
      .from(userSettings)
      .where(and(eq(userSettings.userId, user.id), eq(userSettings.key, "llm")));
    const prev = existing[0]?.value as { apiKeyEnc?: string } | undefined;
    const apiKeyEnc = body.llm.apiKey
      ? encrypt(body.llm.apiKey)
      : (prev?.apiKeyEnc ?? "");
    const value = {
      provider: body.llm.provider ?? "openai-compatible",
      baseUrl: body.llm.baseUrl ?? "",
      model: body.llm.model ?? "",
      apiKeyEnc,
    };
    await db
      .insert(userSettings)
      .values({ userId: user.id, key: "llm", value })
      .onConflictDoUpdate({ target: [userSettings.userId, userSettings.key], set: { value } });
  }

  if (body.fsrs) {
    const value = { requestRetention: body.fsrs.requestRetention ?? 0.9 };
    await db
      .insert(userSettings)
      .values({ userId: user.id, key: "fsrs", value })
      .onConflictDoUpdate({ target: [userSettings.userId, userSettings.key], set: { value } });
  }

  return NextResponse.json({ ok: true });
}
