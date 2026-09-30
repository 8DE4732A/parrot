/** GET /api/settings/llm-key — 仅本人 session 解密下发 apiKey（BYOK 客户端直连用，详设 §7.6） */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { createDecipheriv, createHash } from "node:crypto";

import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureSchema } from "@/lib/ensure-schema";
import { userSettings } from "@/lib/schema";

function decrypt(payload: string): string {
  const secret = process.env.AUTH_SECRET ?? "dev-insecure-secret";
  const key = createHash("sha256").update(secret).digest();
  const [iv, tag, data] = payload.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf-8");
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  await ensureSchema();

  const rows = await db
    .select()
    .from(userSettings)
    .where(and(eq(userSettings.userId, user.id), eq(userSettings.key, "llm")));
  const llm = rows[0]?.value as { apiKeyEnc?: string; baseUrl?: string; model?: string } | undefined;
  if (!llm?.apiKeyEnc) {
    return NextResponse.json({ error: { code: "NO_KEY" } }, { status: 404 });
  }
  return NextResponse.json({ apiKey: decrypt(llm.apiKeyEnc), baseUrl: llm.baseUrl, model: llm.model });
}
