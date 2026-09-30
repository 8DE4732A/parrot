/**
 * 会话获取（详设 §9）
 * - 生产：Auth.js v5 GitHub OAuth（凭据配置后启用，见 auth-github.ts）
 * - 本地开发（无 AUTH_SECRET）：DEV 自动登录，固定 dev 用户——仅 NODE_ENV=development 生效
 */
import { eq } from "drizzle-orm";

import { db } from "./db";
import { ensureSchema } from "./ensure-schema";
import { users } from "./schema";

export interface SessionUser {
  id: number;
  githubLogin: string;
  name: string | null;
  avatarUrl: string | null;
}

async function getDevUser(): Promise<SessionUser> {
  await ensureSchema();
  const login = "dev-local";
  const existing = await db.select().from(users).where(eq(users.githubLogin, login));
  if (existing.length > 0) return existing[0];
  const [inserted] = await db
    .insert(users)
    .values({ githubId: "dev-0", githubLogin: login, name: "本地开发用户" })
    .returning();
  return inserted;
}

/**
 * 获取当前会话用户；未登录返回 null。
 * 本地开发（无 AUTH_SECRET 且 NODE_ENV=development）自动返回 dev 用户，
 * 生产环境绝不走此分支——middleware 强制 OAuth（接 GitHub 凭据后启用 auth-github.ts）。
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const isDev = process.env.NODE_ENV === "development" && !process.env.AUTH_SECRET;
  if (isDev) return getDevUser();

  // 生产：Auth.js session（凭据配置后接入）
  // const session = await auth();
  // if (!session?.user) return null;
  // → upsert users by githubId，返回 SessionUser
  return null;
}
