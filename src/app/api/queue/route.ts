import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getDailyQueue, getFreeReviewQueue } from "@/lib/queue";

/** GET /api/queue — 当日队列（复习+新词，讲解内嵌，详设 §5.2）；mode=free 为自由复习队列 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });

  if (new URL(req.url).searchParams.get("mode") === "free") {
    const limit = Number(new URL(req.url).searchParams.get("limit") ?? 20);
    const reviews = await getFreeReviewQueue(user.id, Math.min(limit || 20, 50));
    return NextResponse.json({ reviews, news: [] });
  }

  const { reviews, news } = await getDailyQueue(user.id);
  return NextResponse.json({ reviews, news });
}
