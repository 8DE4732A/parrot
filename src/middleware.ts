/**
 * 全站鉴权中间件（详设 §9）——Auth.js v5 标准写法
 * - 有凭据时：auth() wrapper 解析 session（与 API 同一套 JWT 逻辑）
 * - 未登录：API 401、页面 302 → 登录页
 * - 本地开发（无凭据）：放行（lib/auth.ts 的 dev 会话兜底）
 */
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { NextResponse } from "next/server";

const hasCredentials =
  !!process.env.AUTH_GITHUB_ID && !!process.env.AUTH_GITHUB_SECRET && !!process.env.AUTH_SECRET;

const { auth } = NextAuth({
  providers: hasCredentials ? [GitHub] : [],
  session: { strategy: "jwt" },
  trustHost: true,
});

export default auth((req) => {
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  if (req.auth) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/api/auth/signin", req.url));
});

// /api/auth/* 完全交给 route handler（双重处理会导致 UnknownAction），
// 由 route handler 的 auth() 实例（含白名单/建档回调）独占
export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|icons|manifest.json|sw.js|favicon.ico|audio).*)",
  ],
};
