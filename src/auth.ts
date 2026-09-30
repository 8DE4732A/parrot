/**
 * Auth.js v5 配置（详设 §9）
 * - GitHub OAuth + 用户白名单（ALLOWED_GITHUB_LOGINS，安全核心闸门）
 * - JWT session（不引入 adapter 表），users 表由 signIn 回调 upsert
 * - 凭据缺失时本模块导出 null（本地开发走 src/lib/auth.ts 的 dev 会话）
 */
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import type { Provider } from "next-auth/providers";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { ensureSchema } from "@/lib/ensure-schema";
import { users } from "@/lib/schema";

const hasGithubCredentials =
  !!process.env.AUTH_GITHUB_ID && !!process.env.AUTH_GITHUB_SECRET && !!process.env.AUTH_SECRET;

const providers: Provider[] = [];
if (hasGithubCredentials) {
  providers.push(GitHub);
}

function allowed(logins: string | undefined): Set<string> {
  return new Set(
    (logins ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  callbacks: {
    async signIn({ user, profile }) {
      // 白名单校验 + users 建档（详设 §9 安全核心）
      const whitelist = allowed(process.env.ALLOWED_GITHUB_LOGINS);
      const login = (profile as { login?: string } | undefined)?.login?.toLowerCase();
      if (!login || !whitelist.has(login)) return false;
      await ensureSchema();
      const existing = await db.select().from(users).where(eq(users.githubId, String(user.id)));
      if (existing.length === 0) {
        await db.insert(users).values({
          githubId: String(user.id),
          githubLogin: login,
          name: user.name,
          avatarUrl: user.image ?? null,
        });
      } else if (existing[0].githubLogin !== login) {
        await db.update(users).set({ githubLogin: login, name: user.name, avatarUrl: user.image ?? null }).where(eq(users.githubId, String(user.id)));
      }
      return true;
    },
    async jwt({ token, user, profile }) {
      if (user?.id) token.githubId = String(user.id);
      const login = (profile as { login?: string } | undefined)?.login;
      if (login) token.githubLogin = login.toLowerCase();
      return token;
    },
  },
});

export const authEnabled = hasGithubCredentials;
