/**
 * 会话获取（详设 §9）
 * - 生产：Auth.js v5 GitHub OAuth（凭据配置后启用，见 auth-github.ts）
 * - 本地开发（无 AUTH_SECRET）：DEV 自动登录，固定 dev 用户——仅 NODE_ENV=development 生效
 */
import { eq } from "drizzle-orm";

import { auth, authEnabled } from "@/auth";
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
 * - 生产（AUTH_GITHUB_ID/SECRET 齐备）：Auth.js session → users 表取 userId
 * - 本地开发（无 AUTH_SECRET 且 NODE_ENV=development）：自动 dev 用户
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  await ensureSchema();
  const isDev = process.env.NODE_ENV === "development" && !process.env.AUTH_SECRET;
  if (!isDev && authEnabled) {
    const session = await auth();
    const login = session?.user?.name;
    if (!login) return null;
    // GitHub username → users 表（signIn 回调已建档）
    const rows = await db.select().from(users).where(eq(users.githubLogin, login.toLowerCase()));
    if (rows.length === 0) return null;
    const u = rows[0];
    return { id: u.id, githubLogin: u.githubLogin, name: u.name, avatarUrl: u.avatarUrl };
  }
  if (isDev) return getDevUser();
  return null;
}
