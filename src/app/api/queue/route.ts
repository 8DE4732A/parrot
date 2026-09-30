import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getDailyQueue } from "@/lib/queue";

/** GET /api/queue — 当日队列（复习+新词，讲解内嵌，详设 §5.2） */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });

  const { reviews, news } = await getDailyQueue(user.id);
  return NextResponse.json({ reviews, news });
}
